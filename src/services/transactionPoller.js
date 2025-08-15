const cron = require('node-cron');
const avaxProvider = require('./nebula');
const { users, transactions, claims } = require('./database');
const claimsService = require('./claims');
const config = require('../config');
const { logger, logUserAction } = require('../utils/logger');

class TransactionPoller {
  constructor(whatsapp) {
    this.whatsapp = whatsapp;
    this.isRunning = false;
    this.lastCheckedBlocks = new Map(); // Track last checked block per user
  }
  
  // Initialize transaction poller
  initialize() {
    try {
      // Schedule polling every 30 seconds
      cron.schedule('*/30 * * * * *', async () => {
        await this.pollTransactions();
      });
      
      logger.info('✅ Transaction poller initialized');
      this.isRunning = true;
      
    } catch (error) {
      logger.error('❌ Failed to initialize transaction poller:', error);
    }
  }
  
  // Main polling function
  async pollTransactions() {
    try {
      if (!this.isRunning) return;
      
      // Get all users with wallets
      const allUsers = await this.getAllUsers();
      
      for (const user of allUsers) {
        await this.checkUserTransactions(user);
      }

      // Confirm pending transactions in DB
      await this.confirmPendingTransactions();

      // Handle claims reminders and refunds (hourly)
      const now = new Date();
      
      // REMINDER SYSTEM DISABLED - No more spam notifications
      // const inOneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      // const reminders = await claims.findPendingForReminder(now, inOneDay);
      // for (const rec of reminders) {
      //   try {
      //     const daysLeft = Math.max(0, Math.ceil((new Date(rec.expires_at) - now) / (24*60*60*1000)));
      //     const whatsappPhone = `${rec.sender_phone}@s.whatsapp.net`;
      //     await this.whatsapp.sendMessage(whatsappPhone, { text: `⏳ Reminder: ${rec.amount_avax} AVAX pending claim for +${rec.recipient_phone} (${daysLeft} day(s) left).` });
      //   } catch (e) {
      //     logger.warn('Failed to send claim reminder:', e?.message || e);
      //   }
      // }

      // Refund expired
      await claimsService.refundExpired(async (rec, tx, gasCost, refundAmount) => {
        try {
          const whatsappPhone = `${rec.sender_phone}@s.whatsapp.net`;
          const originalAmount = rec.amount_avax;
          
          const message = `↩️ *Refund Processed*

💰 *Original Amount:* ${originalAmount} AVAX
⛽ *Gas Fee:* ${gasCost.toFixed(6)} AVAX
💸 *Amount Refunded:* ${refundAmount.toFixed(6)} AVAX
🔗 *Transaction Hash:* \`${tx.hash}\`
📊 *View on Fuji Testnet:* https://testnet.snowtrace.io/tx/${tx.hash}

*Note: Gas fees were deducted to process your refund.*`;
          
          await this.whatsapp.sendMessage(whatsappPhone, message);
        } catch (e) {
          logger.warn('Failed to notify refund:', e?.message || e);
        }
      });
      
    } catch (error) {
      logger.error('Error in transaction polling:', error);
    }
  }

  // Check pending DB transactions and update status from chain
  async confirmPendingTransactions() {
    try {
      const pending = await transactions.findPendingTransactions(50);
      for (const tx of pending) {
        try {
          const status = await avaxProvider.getTransactionStatus(tx.tx_hash);
          if (status && status.status !== 'pending') {
            await transactions.updateTransactionStatus(tx.tx_hash, status.status);
          }
        } catch (e) {
          logger.warn('confirmPendingTransactions: status check failed', e?.message || e);
        }
      }
    } catch (e) {
      logger.warn('confirmPendingTransactions failed:', e?.message || e);
    }
  }
  
  // Check transactions for a specific user
  async checkUserTransactions(user) {
    try {
      const phone = user.phone;
      const walletAddress = user.wallet_address;
      
      // Get last checked block for this user
      const lastCheckedBlock = this.lastCheckedBlocks.get(phone) || 0;
      
      // Get current block number
      const currentBlock = await avaxProvider.provider.getBlockNumber();
      
      // Check if we need to scan new blocks
      if (currentBlock <= lastCheckedBlock) {
        return;
      }
      
      // Scan recent blocks for transactions
      const newTransactions = await this.scanBlocksForTransactions(
        walletAddress,
        lastCheckedBlock + 1,
        currentBlock
      );
      
      // Process new transactions
      for (const tx of newTransactions) {
        await this.processIncomingTransaction(user, tx);
      }
      
      // Update last checked block
      this.lastCheckedBlocks.set(phone, currentBlock);
      
    } catch (error) {
      logger.error(`Error checking transactions for user ${user.phone}:`, error);
    }
  }
  
  // Scan blocks for transactions involving the wallet address
  async scanBlocksForTransactions(walletAddress, fromBlock, toBlock) {
    const transactions = [];
    
    try {
      // Limit the scan range to avoid overwhelming the RPC
      const maxBlocksToScan = 10;
      const actualToBlock = Math.min(toBlock, fromBlock + maxBlocksToScan);
      
      for (let blockNumber = fromBlock; blockNumber <= actualToBlock; blockNumber++) {
        try {
          const block = await avaxProvider.provider.getBlock(blockNumber, true);
          
          if (!block || !block.transactions) continue;
          
          for (const tx of block.transactions) {
            // Check if this transaction involves our wallet address
            if (tx.to && tx.to.toLowerCase() === walletAddress.toLowerCase() && 
                tx.from.toLowerCase() !== walletAddress.toLowerCase()) {
              
              transactions.push({
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: avaxProvider.formatAvax(tx.value),
                blockNumber: tx.blockNumber,
                timestamp: block.timestamp,
                type: 'incoming'
              });
            }
          }
        } catch (blockError) {
          logger.warn(`Error scanning block ${blockNumber}:`, blockError);
          continue;
        }
      }
      
    } catch (error) {
      logger.error('Error scanning blocks for transactions:', error);
    }
    
    return transactions;
  }
  
  // Process incoming transaction and send notification
  async processIncomingTransaction(user, transaction) {
    try {
      const phone = user.phone;
      
      // Check if we've already processed this transaction
      const existingTx = await transactions.findTransactionByHash(transaction.hash);
      if (existingTx) {
        return;
      }
      
      // Save transaction to database
      const txData = {
        user_phone: phone,
        tx_hash: transaction.hash,
        from: transaction.from,
        to: transaction.to,
        amount: transaction.value,
        status: 'success',
        timestamp: new Date(transaction.timestamp * 1000)
      };
      
      await transactions.createTransaction(txData);
      
      // Send notification to user
      await this.sendIncomingNotification(phone, transaction);
      
      // Log the incoming transaction
      logUserAction(phone, 'incoming_transaction', {
        hash: transaction.hash,
        amount: transaction.value,
        from: transaction.from
      });
      
      logger.info(`Incoming transaction processed: ${transaction.hash} for user ${phone}`);
      
    } catch (error) {
      logger.error('Error processing incoming transaction:', error);
    }
  }
  
  // Send incoming transaction notification
  async sendIncomingNotification(phone, transaction) {
    try {
      const fromDisplay = this.formatAddress(transaction.from);
      const amount = parseFloat(transaction.value).toFixed(6);
      const timestamp = new Date(transaction.timestamp * 1000).toLocaleString();
      
      const message = `📥 *Incoming AVAX!*

💰 *Amount:* ${amount} AVAX
👤 *From:* ${fromDisplay}
🏦 *Address:* \`${transaction.from}\`
📅 *Time:* ${timestamp}
🔗 *Hash:* \`${transaction.hash}\`

🔍 [View on Explorer](https://testnet.snowtrace.io/tx/${transaction.hash})

Your wallet has been credited! 💎`;
      
      // Convert phone to WhatsApp format
      const whatsappPhone = `${phone}@s.whatsapp.net`;
      
      await this.whatsapp.sendMessage(whatsappPhone, message);
      
    } catch (error) {
      logger.error('Error sending incoming notification:', error);
    }
  }
  
  // Get all users with wallets
  async getAllUsers() {
    try {
      // Get all users from database
      const allUsers = await users.find({});
      return allUsers;
    } catch (error) {
      logger.error('Error getting all users:', error);
      return [];
    }
  }
  
  // Format address for display
  formatAddress(address) {
    try {
      return `${address.slice(0, 6)}...${address.slice(-4)}`;
    } catch (error) {
      return address;
    }
  }
  
  // Start polling
  start() {
    this.isRunning = true;
    logger.info('🔄 Transaction polling started');
  }
  
  // Stop polling
  stop() {
    this.isRunning = false;
    logger.info('⏹️ Transaction polling stopped');
  }
  
  // Get polling status
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastCheckedBlocks: Object.fromEntries(this.lastCheckedBlocks),
      userCount: this.lastCheckedBlocks.size
    };
  }
}

// Initialize transaction poller
const initializeTransactionPoller = (whatsapp) => {
  const poller = new TransactionPoller(whatsapp);
  poller.initialize();
  return poller;
};

module.exports = {
  initializeTransactionPoller,
  TransactionPoller
};
