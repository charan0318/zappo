const nebulaService = require('../services/nebula');
const walletHandler = require('./walletHandler');
const claimsService = require('../services/claims');
const { users, transactions } = require('../services/database');
const { logger, logUserAction, logTransaction } = require('../utils/logger');

class TransactionHandler {
  constructor() {
    this.pendingTransactions = new Map();
  }
  
  // Handle balance check request
  async handleGetBalance(from, phone) {
    try {
      // Get user wallet
      const wallet = await walletHandler.getUserWallet(phone);
      if (!wallet) {
        await this.sendMessage(from, 'You don’t have a wallet yet. Would you like me to create one for you now, or do you want to import an existing one?');
        return;
      }
      
      // Format balance
      const balance = parseFloat(wallet.balance).toFixed(6);
      const hasZeroBalance = parseFloat(balance) === 0;
      
      if (hasZeroBalance) {
        await this.sendMessage(from, `💰 *Wallet Balance*

🏦 *Address:* \`${wallet.address}\`
💎 *Balance:* ${balance} AVAX

⚠️ *Your wallet is empty!*
💡 *To start sending AVAX, please deposit some AVAX to your wallet first.*

📋 *Your wallet address for deposits:*`);
        
        // Send address as separate message for easy copying
        await this.sendMessage(from, `\`${wallet.address}\`\n\n*Tap to copy this address!*`);
      } else {
        await this.sendMessage(from, `💰 *Wallet Balance*

🏦 *Address:* \`${wallet.address}\`
💎 *Balance:* ${balance} AVAX

💡 *Tip:* Use \`/history\` to see your recent transactions.`);
      }
      
      logUserAction(phone, 'balance_checked', { balance });
      
    } catch (error) {
      logger.error('Error getting balance:', error);
      await this.sendMessage(from, `❌ Error getting balance: ${error.message}`);
    }
  }
  
  // Handle transaction history request
  async handleGetHistory(from, phone) {
    try {
      // Get user wallet
      const wallet = await walletHandler.getUserWallet(phone);
      if (!wallet) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }
      
      // Get recent transactions from database
      const dbTransactions = await transactions.findTransactionsByUser(phone, 10);
      
      // Skip blockchain scanning for now as it's too slow - rely on database
      let allTransactions = dbTransactions;
      
      // If no database transactions, try a quick blockchain check
      if (dbTransactions.length === 0) {
        try {
          // Quick timeout for blockchain check
          const blockchainTxs = await Promise.race([
            nebulaService.getAddressTransactions(wallet.address, 3),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
          ]);
          allTransactions = blockchainTxs;
        } catch (error) {
          logger.warn('Blockchain transaction lookup timed out, showing database only');
          allTransactions = dbTransactions;
        }
      }
      
      // Combine and format transactions
      allTransactions = allTransactions
        .sort((a, b) => new Date(b.timestamp || b.created_at) - new Date(a.timestamp || a.created_at))
        .slice(0, 5);
      
      if (allTransactions.length === 0) {
        await this.sendMessage(from, `📋 *Transaction History*

🏦 *Address:* \`${wallet.address}\`
📝 *Status:* No transactions found

Your wallet is ready for transactions!`);
        return;
      }
      
      let historyMessage = `📋 *Recent Transactions*\n\n`;
      
      for (const tx of allTransactions) {
        const timestamp = new Date(tx.timestamp || tx.created_at).toLocaleString();
        const amount = tx.amount || tx.value || '0';
        const status = tx.status || 'completed';
        const type = tx.type || (tx.from === wallet.address ? 'outgoing' : 'incoming');
        const hash = tx.tx_hash || tx.hash;
        
        const statusEmoji = status === 'success' || status === 'completed' ? '✅' : 
                           status === 'pending' ? '⏳' : '❌';
        const typeEmoji = type === 'outgoing' ? '📤' : '📥';
        
        historyMessage += `${statusEmoji} ${typeEmoji} *${amount} AVAX* (${type})\n`;
        historyMessage += `📅 ${timestamp}\n`;
        historyMessage += `🔗 [View on Explorer](https://snowtrace.io/tx/${hash})\n\n`;
      }
      
      historyMessage += `🏦 *Address:* \`${wallet.address}\``;
      
      await this.sendMessage(from, historyMessage);
      
      logUserAction(phone, 'history_checked', { transactionCount: allTransactions.length });
      
    } catch (error) {
      logger.error('Error getting transaction history:', error);
      await this.sendMessage(from, `❌ Error getting transaction history: ${error.message}`);
    }
  }
  
  // Handle send transaction request
  async handleSendTransaction(from, phone, sendParams) {
    try {
      // Get user wallet
      const wallet = await walletHandler.getUserWallet(phone);
      if (!wallet) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }
      
      // Validate recipient
      let recipientAddress = sendParams.recipient;
      let recipientPhone = null;
      
      // If not a valid address, see if it's a saved contact or a phone number
      if (!nebulaService.validateAddress(recipientAddress)) {
        const contact = await this.getContactByPhone(phone, recipientAddress);
        if (contact) {
          recipientAddress = contact.address;
        } else {
          const phoneLike = recipientAddress.replace(/\D/g, '');
          if (phoneLike.length >= 8) {
            recipientPhone = phoneLike;
          } else {
            await this.sendMessage(from, 'That recipient isn’t valid yet. Please share a contact who uses ZAPPO, paste a 0x address, or provide a phone number.');
            return;
          }
        }
      }
      
      // Check if recipient is the same as sender
      if (recipientAddress.toLowerCase() === wallet.address.toLowerCase()) {
        await this.sendMessage(from, 'You can’t send AVAX to your own address.');
        return;
      }
      
      // Check balance
      const currentBalance = parseFloat(wallet.balance);
      const sendAmount = parseFloat(sendParams.amount);
      
      if (sendAmount > currentBalance) {
        await this.sendMessage(from, `Insufficient balance. You have ${currentBalance.toFixed(6)} AVAX and tried to send ${sendAmount} AVAX.`);
        return;
      }
      
      // Warn about small amounts for unregistered recipients (claim-links)
      if (recipientPhone && sendAmount < 0.01) {
        await this.sendMessage(from, `⚠️ *Small Amount Warning*

You're sending ${sendAmount} AVAX to an unregistered user.

📊 *Gas Fee Info:*
• Estimated claim gas: ~0.002 AVAX
• Recommended minimum: 0.005 AVAX
• Recipient will get: ~${Math.max(0, sendAmount - 0.002).toFixed(6)} AVAX

💡 *Tip:* Send at least 0.005 AVAX for better claim success rate.

Continue? React with 👍 (yes) or 👎 (cancel)`);
        
        // Set user state to wait for confirmation
        this.pendingTransactions.set(phone, {
          type: 'small_amount_confirmation',
          originalParams: sendParams,
          timestamp: Date.now()
        });
        return;
      }
      
      // Estimate gas (for direct send). For claim-link we’ll send to ephemeral wallet later
      const gasEstimate = recipientPhone
        ? { gasLimit: '21000', gasPrice: '0', estimatedCost: '0.0003' }
        : await nebulaService.estimateGas(wallet.address, recipientAddress, sendAmount);
      const totalCost = sendAmount + parseFloat(gasEstimate.estimatedCost);
      
      if (totalCost > currentBalance) {
        await this.sendMessage(from, `You don’t have enough to cover amount + gas. Estimated total: ${totalCost.toFixed(6)} AVAX.`);
        return;
      }
      
      // Create transaction summary
      const transactionData = {
        from: wallet.address,
        to: recipientAddress,
        amount: sendAmount,
        gasEstimate: gasEstimate,
        totalCost: totalCost,
        phone: phone,
        recipientPhone
      };
      
      // Store pending transaction (now shared with command handler)
      this.pendingTransactions.set(phone, transactionData);
      
      // Send confirmation message
      const recipientDisplay = this.formatAddress(recipientAddress);
      const contactName = await this.getContactNameByPhone(phone, recipientAddress);
      
      if (recipientPhone) {
        await this.sendMessage(from, `👤 This contact isn’t registered on ZAPPO yet.

I can hold ${sendAmount} AVAX for 3 days so they can claim it.
React with 👍 to proceed, or 👎 to cancel.`);
      } else {
        await this.sendMessage(from, `📤 *Review & Confirm*

You are about to send funds on Avalanche C-Chain.

💰 Amount: ${sendAmount} AVAX
👤 To: ${contactName ? contactName : recipientDisplay}
🏦 Address: \`${recipientAddress}\`
⛽ Gas (est.): ~${parseFloat(gasEstimate.estimatedCost).toFixed(6)} AVAX
💸 Total (est.): ${totalCost.toFixed(6)} AVAX

React with 👍 to confirm or 👎 to cancel.
(Or type "YES" to confirm / "NO" to cancel)`);
      }
      
      logUserAction(phone, 'transaction_pending', { amount: sendAmount, to: recipientAddress });
      
    } catch (error) {
      logger.error('Error handling send transaction:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Execute pending transaction
  async executePendingTransaction(from, phone, transactionData) {
    try {
      await this.sendMessage(from, 'Processing your transaction… this usually takes a moment.');
      
      // Get wallet provider
      const walletProvider = await walletHandler.getWalletProvider(phone);
      
      let txResult;
      
      if (transactionData.recipientPhone) {
        // Claim-link flow: create ephemeral wallet, move funds there, save claim, send link back
        const privy = require('../services/privy');
        const ephemeral = await privy.createWallet('ephemeral');
        if (!ephemeral.success) {
          throw new Error('Could not create claim wallet. Please try again later.');
        }
        const ephemeralWalletId = ephemeral.privyWalletId;
        const ephemeralAddress = ephemeral.walletAddress;
        
        txResult = await nebulaService.sendTransaction(
          walletProvider,
          ephemeralAddress,
          transactionData.amount,
          transactionData.gasEstimate?.gasLimit || null
        );
        
        const { link } = await claimsService.createHold({
          senderPhone: phone,
          senderAddress: transactionData.from,
          recipientPhone: transactionData.recipientPhone,
          amountAvax: transactionData.amount,
          ephemeralWalletId,
          ephemeralWalletAddress: ephemeralAddress,
          holdTxHash: txResult.hash
        });
        
        await this.sendMessage(from, `✅ Claim link created.

💰 Amount: ${transactionData.amount} AVAX
🔗 Hash: \`${txResult.hash}\`
📊 View on Snowtrace: https://snowtrace.io/tx/${txResult.hash}

💡 *Note:* Gas fees for processing the claim will be deducted from this amount.

Please forward this to your contact:
Claim link: ${link}`);
      } else {
        // Direct send
        txResult = await nebulaService.sendTransaction(
          walletProvider,
          transactionData.to,
          transactionData.amount,
          transactionData.gasEstimate?.gasLimit || null
        );
        
        await this.sendMessage(from, `✅ Transaction submitted!

💰 Amount: ${transactionData.amount} AVAX
👤 To: \`${transactionData.to}\`
🔗 Hash: \`${txResult.hash}\`

View on Snowtrace: https://snowtrace.io/tx/${txResult.hash}`);
      }
      
      // Save transaction to database
      const txData = {
        user_phone: phone,
        tx_hash: txResult.hash,
        from: txResult.from,
        to: txResult.to,
        amount: txResult.value,
        status: 'pending',
        gas_used: txResult.gasLimit,
        gas_price: txResult.gasPrice
      };
      
      await transactions.createTransaction(txData);
      
      // Send success message
      await this.sendMessage(from, `✅ Transaction submitted!

💰 Amount: ${transactionData.amount} AVAX
👤 To: \`${transactionData.to}\`
🔗 Hash: \`${txResult.hash}\`

View on Snowtrace: https://snowtrace.io/tx/${txResult.hash}`);
      
      logTransaction(txResult.hash, txResult.from, txResult.to, txResult.value, 'pending');
      logUserAction(phone, 'transaction_sent', { hash: txResult.hash, amount: transactionData.amount });
      
      // Clear pending transaction
      this.pendingTransactions.delete(phone);
      
    } catch (error) {
      logger.error('Error executing transaction:', error);
      await this.sendMessage(from, `We couldn’t send the transaction: ${error.message}`);
      this.pendingTransactions.delete(phone);
    }
  }
  
  // Get transaction status
  async getTransactionStatus(txHash) {
    try {
      const status = await nebulaService.getTransactionStatus(txHash);
      return status;
    } catch (error) {
      logger.error('Error getting transaction status:', error);
      throw error;
    }
  }
  
  // Update transaction status in database
  async updateTransactionStatus(txHash, status) {
    try {
      await transactions.updateTransactionStatus(txHash, status);
    } catch (error) {
      logger.error('Error updating transaction status:', error);
    }
  }
  
  // Get contact by name
  async getContactByPhone(ownerPhone, name) {
    try {
      const { contacts } = require('../services/database');
      return await contacts.findContactByName(ownerPhone, name);
    } catch (error) {
      logger.error('Error getting contact:', error);
      return null;
    }
  }
  
  // Get contact name by address
  async getContactNameByPhone(ownerPhone, address) {
    try {
      const { contacts } = require('../services/database');
      const contact = await contacts.findContactByAddress(ownerPhone, address);
      return contact ? contact.name : null;
    } catch (error) {
      logger.error('Error getting contact name:', error);
      return null;
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
  
  // Send message helper (this should be injected from command handler)
  async sendMessage(to, message) {
    // This will be overridden by the command handler
    console.log(`[TRANSACTION] ${to}: ${message}`);
  }
}

module.exports = new TransactionHandler();
