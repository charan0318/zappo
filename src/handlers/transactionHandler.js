const nebulaService = require('../services/nebula');
const walletHandler = require('./walletHandler');
const claimsService = require('../services/claims');
const { users, transactions } = require('../services/database');
const { logger, logUserAction, logTransaction } = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const errorRecovery = require('../utils/errorRecovery');

class TransactionHandler {
  constructor() {
    this.pendingTransactions = new Map();
  }
  
  // Handle balance check request
  async handleGetBalance(from, phone) {
    try {
      // Use retry mechanism for critical operations
      const result = await errorHandler.withRetry(async () => {
        // Get user wallet
        const wallet = await walletHandler.getUserWallet(phone);
        if (!wallet) {
          throw new Error('Wallet not found. Please create a wallet first.');
        }

        // Get fresh balance from blockchain
        const currentBalance = await nebulaService.getBalance(wallet.address);
        
        // Update wallet balance in database
        await users.updateUserWallet(phone, { balance: currentBalance.toString() });
        
        return { wallet, currentBalance };
      }, 3, 1000);
      
      // Log the balance check
      logUserAction(phone, 'balance_check', { balance: result.currentBalance });
      
      await this.sendMessage(from, `💰 *Current Balance*\n\n${result.currentBalance.toFixed(6)} AVAX\n\n📍 Wallet: \`${result.wallet.address}\``);
      
    } catch (error) {
      const errorInfo = errorHandler.handleError(error, { 
        action: 'get_balance', 
        phone,
        from 
      });
      
      const userMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
      await this.sendMessage(from, userMessage);
    }
  }
  
  // Handle transaction history request
  async handleGetTransactions(from, phone, limit = 10) {
    try {
      const result = await errorHandler.withRetry(async () => {
        // Get user wallet
        const wallet = await walletHandler.getUserWallet(phone);
        if (!wallet) {
          throw new Error('Wallet not found. Please create a wallet first.');
        }

        // Get recent transactions
        const recentTxs = await transactions.getRecentTransactions(phone, limit);
        return { wallet, recentTxs };
      }, 2, 500);
      
      if (result.recentTxs.length === 0) {
        await this.sendMessage(from, '📊 *Transaction History*\n\nNo transactions found yet.\n\nStart by sending some AVAX or receiving payments!');
        return;
      }

      let historyMessage = `📊 *Recent Transactions*\n\n`;
      
      for (const tx of result.recentTxs) {
        const date = new Date(tx.timestamp).toLocaleDateString();
        const type = tx.from_address?.toLowerCase() === result.wallet.address.toLowerCase() ? '📤 Sent' : '📥 Received';
        const amount = parseFloat(tx.amount_avax || 0).toFixed(4);
        
        historyMessage += `${type}: ${amount} AVAX\n`;
        historyMessage += `📅 ${date}\n`;
        if (tx.tx_hash) {
          historyMessage += `🔗 [View](https://snowtrace.io/tx/${tx.tx_hash})\n`;
        }
        historyMessage += `\n`;
      }
      
      // Log the transaction history request
      logUserAction(phone, 'transaction_history', { count: result.recentTxs.length });
      
      await this.sendMessage(from, historyMessage);
      
    } catch (error) {
      const errorInfo = errorHandler.handleError(error, { 
        action: 'get_transactions', 
        phone,
        from,
        limit 
      });
      
      const userMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
      await this.sendMessage(from, userMessage);
    }
  }

  // Handle send transaction request
  async handleSendTransaction(from, phone, sendParams) {
    try {
      logger.info(`Processing send transaction for ${phone}:`, sendParams);
      
      // Validate input parameters
      if (!sendParams || !sendParams.amount) {
        throw new Error('Missing parameters. Please provide amount and recipient.');
      }

      const sendAmount = parseFloat(sendParams.amount);
      if (isNaN(sendAmount) || sendAmount <= 0) {
        throw new Error('Invalid amount. Amount must be greater than 0.');
      }

      const result = await errorHandler.withRetry(async () => {
        // Get user wallet
        const wallet = await walletHandler.getUserWallet(phone);
        if (!wallet) {
          throw new Error('Wallet not found. Please create a wallet first.');
        }

        // Parse recipient details
        const { recipientAddress, recipientPhone, name } = sendParams;
        
        // Get fresh balance
        const currentBalance = parseFloat(wallet.balance);
        
        if (sendAmount > currentBalance) {
          throw new Error(`Insufficient balance. You have ${currentBalance.toFixed(6)} AVAX and tried to send ${sendAmount} AVAX.`);
        }
        
        // Estimate gas (for direct send). For claim-link we'll send to ephemeral wallet later
        const gasEstimate = recipientPhone
          ? { gasLimit: '21000', gasPrice: '0', estimatedCost: '0.0003' }
          : await nebulaService.estimateGas(wallet.address, recipientAddress, sendAmount);
        
        // For direct sends, user needs to cover amount + gas
        // For claim-links, user only needs to cover the send amount (gas is paid during claim)
        const totalCost = recipientPhone ? sendAmount : sendAmount + parseFloat(gasEstimate.estimatedCost);
        
        if (totalCost > currentBalance) {
          const message = recipientPhone 
            ? `Insufficient balance. You have ${currentBalance.toFixed(6)} AVAX and tried to send ${sendAmount} AVAX.`
            : `You don't have enough to cover amount + gas. Estimated total: ${totalCost.toFixed(6)} AVAX.`;
          throw new Error(message);
        }
        
        return { wallet, recipientAddress, recipientPhone, name, currentBalance, gasEstimate, totalCost };
      }, 2, 1000);

      // Create transaction summary
      const transactionData = {
        from: result.wallet.address,
        to: result.recipientAddress,
        amount: sendAmount,
        gasEstimate: result.gasEstimate,
        totalCost: result.totalCost,
        phone: phone,
        recipientPhone: result.recipientPhone
      };

      // Show confirmation
      const recipientDisplay = result.name || result.recipientAddress || result.recipientPhone;
      const feeDisplay = result.recipientPhone ? 'Free (claim-link)' : `${parseFloat(result.gasEstimate.estimatedCost).toFixed(6)} AVAX`;
      
      const confirmMessage = `🔄 *Transaction Confirmation*

💸 *Sending:* ${sendAmount} AVAX
👤 *To:* ${recipientDisplay}
⛽ *Gas Fee:* ${feeDisplay}
💰 *Total Cost:* ${result.totalCost.toFixed(6)} AVAX

${result.recipientPhone ? '📱 *Note:* Recipient will receive a claim link' : ''}

Confirm? React with 👍 (yes) or 👎 (cancel)`;

      await this.sendMessage(from, confirmMessage);
      
      // Store pending transaction
      this.pendingTransactions.set(phone, {
        type: 'send_transaction',
        data: transactionData,
        originalParams: sendParams,
        timestamp: Date.now()
      });
      
    } catch (error) {
      const errorInfo = errorHandler.handleError(error, { 
        action: 'send_transaction', 
        phone,
        from,
        sendParams 
      });
      
      const userMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
      await this.sendMessage(from, userMessage);
    }
  }

  // Execute confirmed transaction
  async executePendingTransaction(from, phone, pendingTx) {
    try {
      const { data, originalParams } = pendingTx;
      
      const result = await errorHandler.withRetry(async () => {
        // Get fresh wallet and balance
        const wallet = await walletHandler.getUserWallet(phone);
        const currentBalance = parseFloat(wallet.balance);
        
        // Double-check balance hasn't changed
        if (data.totalCost > currentBalance) {
          throw new Error('Insufficient balance. Your balance may have changed since confirmation.');
        }

        let txResult;
        
        if (data.recipientPhone) {
          // Create claim link for unregistered user
          txResult = await claimsService.createClaimLink(
            phone,
            data.recipientPhone,
            data.amount,
            originalParams.name || 'Unknown'
          );
          
          if (!txResult.success) {
            throw new Error(`Failed to create claim link: ${txResult.error}`);
          }
          
          return { type: 'claim_link', result: txResult };
        } else {
          // Direct transaction to registered user
          txResult = await nebulaService.sendTransaction(
            wallet.address,
            data.to,
            data.amount
          );
          
          if (!txResult || !txResult.hash) {
            throw new Error('Transaction failed. Please try again.');
          }
          
          return { type: 'direct', result: txResult };
        }
      }, 2, 2000);

      // Send success message based on transaction type
      if (result.type === 'direct') {
        await this.sendMessage(from, `✅ *Transaction Successful*

💸 *Sent:* ${data.amount} AVAX
👤 *To:* ${data.to}
⛽ *Gas:* ${parseFloat(data.gasEstimate.estimatedCost).toFixed(6)} AVAX
🔗 *Transaction:* [View on Snowtrace](https://snowtrace.io/tx/${result.result.hash})`);

        // Log successful transaction
        logTransaction(phone, data.to, data.amount, 'sent', result.result.hash);
        
        // Update balances
        await this.updateUserBalance(phone);
        
      } else {
        await this.sendMessage(from, `✅ *Claim Link Created*

💸 *Amount:* ${data.amount} AVAX
📱 *Recipient:* ${data.recipientPhone}
🔗 *Claim Link:* ${result.result.claimUrl}

The recipient will be notified and can claim their AVAX!`);

        // Log successful claim link creation
        logTransaction(phone, data.recipientPhone, data.amount, 'claim_link_created', result.result.ephemeralAddress);
      }
      
    } catch (error) {
      const errorInfo = errorHandler.handleError(error, { 
        action: 'execute_transaction', 
        phone,
        from,
        pendingTx 
      });
      
      let userMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
      
      // Add specific guidance for transaction failures
      if (errorInfo.code.startsWith('TX_')) {
        userMessage += '\n\n💡 *Tips:*\n' +
          '• Check your internet connection\n' +
          '• Try again during off-peak hours\n' +
          '• Ensure sufficient balance for gas fees';
      }
      
      await this.sendMessage(from, userMessage);
    }
  }

  // Update user balance from blockchain
  async updateUserBalance(phone) {
    try {
      await errorHandler.withRetry(async () => {
        const wallet = await walletHandler.getUserWallet(phone);
        if (!wallet) {
          throw new Error('Wallet not found');
        }

        const currentBalance = await nebulaService.getBalance(wallet.address);
        await users.updateUserWallet(phone, { balance: currentBalance.toString() });
        
        return currentBalance;
      }, 3, 1000);
      
    } catch (error) {
      // Silent fail for balance updates - don't interrupt user flow
      logger.error('Failed to update user balance:', {
        phone,
        error: error.message
      });
    }
  }

  // Send message helper
  async sendMessage(from, message) {
    try {
      if (this.messageHandler) {
        await this.messageHandler(from, message);
      }
    } catch (error) {
      logger.error('Failed to send message:', {
        from,
        message: message.substring(0, 100),
        error: error.message
      });
      
      // Don't throw - message sending failures shouldn't break the flow
    }
  }

  // Set message handler
  setMessageHandler(handler) {
    this.messageHandler = handler;
  }
}

module.exports = new TransactionHandler();
