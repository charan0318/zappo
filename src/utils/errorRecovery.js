const { logger } = require('./logger');
const errorHandler = require('./errorHandler');

class ErrorRecovery {
  constructor() {
    this.recoveryActions = new Map();
    this.initializeRecoveryActions();
  }

  initializeRecoveryActions() {
    // Wallet recovery actions
    this.recoveryActions.set('WALLET_001', {
      action: 'suggest_wallet_creation',
      message: '🆕 Would you like me to help you create a new wallet? Reply "create wallet" to get started.'
    });

    // Transaction recovery actions
    this.recoveryActions.set('TX_001', {
      action: 'suggest_retry',
      message: '🔄 Would you like to try the transaction again? Reply "retry" or wait a few minutes for better network conditions.'
    });

    this.recoveryActions.set('TX_002', {
      action: 'check_status',
      message: '🔍 I can check your transaction status. Reply "status" to see recent transactions.'
    });

    // Network recovery actions
    this.recoveryActions.set('NET_001', {
      action: 'network_help',
      message: '📶 Network issues detected. Try:\n• Check your internet connection\n• Switch networks if possible\n• Wait a few minutes and try again'
    });

    // Balance recovery actions
    this.recoveryActions.set('WALLET_003', {
      action: 'balance_help',
      message: '💰 Need more AVAX? You can:\n• Receive from another wallet\n• Buy AVAX on an exchange\n• Check your recent transactions with "history"'
    });
  }

  /**
   * Get recovery suggestion for an error
   */
  getRecoveryAction(errorCode) {
    return this.recoveryActions.get(errorCode);
  }

  /**
   * Handle user recovery action
   */
  async handleRecoveryAction(action, userPhone, messageHandler) {
    try {
      switch (action) {
        case 'suggest_wallet_creation':
          await messageHandler(userPhone, 
            '🔐 Creating a wallet is easy and secure!\n\n' +
            'Just reply "create wallet" and I\'ll guide you through the process.\n\n' +
            'Your wallet will be:\n' +
            '✅ Encrypted and secure\n' +
            '✅ Linked to your phone number\n' +
            '✅ Ready to use immediately'
          );
          break;

        case 'suggest_retry':
          await messageHandler(userPhone,
            '🔄 Ready to try again?\n\n' +
            'You can:\n' +
            '• Retry your last transaction\n' +
            '• Check your balance first\n' +
            '• Try a smaller amount\n\n' +
            'What would you like to do?'
          );
          break;

        case 'check_status':
          await messageHandler(userPhone,
            '🔍 I can help you check:\n\n' +
            '• Recent transaction history\n' +
            '• Current balance\n' +
            '• Transaction status\n\n' +
            'Reply "history", "balance", or describe what you\'re looking for.'
          );
          break;

        case 'network_help':
          await messageHandler(userPhone,
            '🌐 Network Troubleshooting:\n\n' +
            '1️⃣ Check your internet connection\n' +
            '2️⃣ Try switching between WiFi/Mobile data\n' +
            '3️⃣ Wait 1-2 minutes for network recovery\n' +
            '4️⃣ Try your request again\n\n' +
            'If issues persist, our team is investigating.'
          );
          break;

        case 'balance_help':
          await messageHandler(userPhone,
            '💰 Need AVAX? Here are your options:\n\n' +
            '📥 **Receive AVAX:**\n' +
            '• Share your wallet address\n' +
            '• Request payment from friends\n\n' +
            '🏪 **Buy AVAX:**\n' +
            '• Use exchanges like Binance, Coinbase\n' +
            '• Buy on DEXs like TraderJoe\n\n' +
            'Reply "address" to get your wallet address!'
          );
          break;

        default:
          logger.warn('Unknown recovery action:', action);
      }
    } catch (error) {
      logger.error('Error in recovery action:', {
        action,
        userPhone,
        error: error.message
      });
    }
  }

  /**
   * Create enhanced error message with recovery options
   */
  createEnhancedErrorMessage(errorInfo) {
    let message = errorHandler.formatErrorMessage(errorInfo);
    
    const recovery = this.getRecoveryAction(errorInfo.code);
    if (recovery) {
      message += '\n\n' + recovery.message;
    }
    
    return message;
  }
}

module.exports = new ErrorRecovery();
