const { logger } = require('./logger');

class ErrorHandler {
  constructor() {
    this.errorCodes = {
      // Wallet Errors
      WALLET_NOT_FOUND: 'WALLET_001',
      WALLET_CREATION_FAILED: 'WALLET_002',
      INSUFFICIENT_BALANCE: 'WALLET_003',
      INVALID_ADDRESS: 'WALLET_004',
      
      // Transaction Errors
      TRANSACTION_FAILED: 'TX_001',
      TRANSACTION_TIMEOUT: 'TX_002',
      GAS_ESTIMATION_FAILED: 'TX_003',
      NONCE_TOO_LOW: 'TX_004',
      REPLACEMENT_UNDERPRICED: 'TX_005',
      
      // Network Errors
      NETWORK_ERROR: 'NET_001',
      RPC_ERROR: 'NET_002',
      CONNECTION_TIMEOUT: 'NET_003',
      
      // User Input Errors
      INVALID_AMOUNT: 'INPUT_001',
      INVALID_COMMAND: 'INPUT_002',
      MISSING_PARAMETERS: 'INPUT_003',
      
      // Service Errors
      PRIVY_ERROR: 'SERV_001',
      NEBULA_ERROR: 'SERV_002',
      DATABASE_ERROR: 'SERV_003',
      WHATSAPP_ERROR: 'SERV_004',
      
      // Rate Limiting
      RATE_LIMIT_EXCEEDED: 'RATE_001',
      DAILY_LIMIT_EXCEEDED: 'RATE_002',
      
      // System Errors
      INTERNAL_ERROR: 'SYS_001',
      SERVICE_UNAVAILABLE: 'SYS_002'
    };
  }

  /**
   * Handle and format errors for user display
   */
  handleError(error, context = {}) {
    const errorInfo = this.categorizeError(error);
    
    // Log the full error details
    logger.error('Error handled:', {
      code: errorInfo.code,
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString()
    });

    return {
      code: errorInfo.code,
      userMessage: errorInfo.userMessage,
      technicalMessage: error.message,
      retryable: errorInfo.retryable,
      severity: errorInfo.severity
    };
  }

  /**
   * Categorize errors and provide user-friendly messages
   */
  categorizeError(error) {
    const message = error.message?.toLowerCase() || '';
    
    // Wallet Errors
    if (message.includes('wallet not found') || message.includes('user not registered')) {
      return {
        code: this.errorCodes.WALLET_NOT_FOUND,
        userMessage: '🔐 Wallet not found. Please create a wallet first by typing "create wallet".',
        retryable: false,
        severity: 'medium'
      };
    }
    
    if (message.includes('insufficient funds') || message.includes('insufficient balance')) {
      return {
        code: this.errorCodes.INSUFFICIENT_BALANCE,
        userMessage: '💰 Insufficient balance. Please check your balance and try again.',
        retryable: false,
        severity: 'low'
      };
    }
    
    if (message.includes('invalid address') || message.includes('invalid recipient')) {
      return {
        code: this.errorCodes.INVALID_ADDRESS,
        userMessage: '📍 Invalid wallet address. Please check the address and try again.',
        retryable: false,
        severity: 'low'
      };
    }
    
    // Transaction Errors
    if (message.includes('transaction failed') || message.includes('execution reverted')) {
      return {
        code: this.errorCodes.TRANSACTION_FAILED,
        userMessage: '❌ Transaction failed. This might be due to network congestion. Please try again in a few minutes.',
        retryable: true,
        severity: 'medium'
      };
    }
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        code: this.errorCodes.TRANSACTION_TIMEOUT,
        userMessage: '⏱️ Transaction timed out. Please check your transaction status or try again.',
        retryable: true,
        severity: 'medium'
      };
    }
    
    if (message.includes('nonce too low')) {
      return {
        code: this.errorCodes.NONCE_TOO_LOW,
        userMessage: '🔄 Transaction conflict detected. Please wait a moment and try again.',
        retryable: true,
        severity: 'low'
      };
    }
    
    if (message.includes('replacement transaction underpriced')) {
      return {
        code: this.errorCodes.REPLACEMENT_UNDERPRICED,
        userMessage: '⛽ Gas price too low. Please try again with higher gas.',
        retryable: true,
        severity: 'low'
      };
    }
    
    if (message.includes('gas required exceeds allowance') || message.includes('out of gas')) {
      return {
        code: this.errorCodes.GAS_ESTIMATION_FAILED,
        userMessage: '⛽ Transaction requires more gas than available. Please try with a smaller amount.',
        retryable: false,
        severity: 'medium'
      };
    }
    
    // Network Errors
    if (message.includes('network error') || message.includes('connection refused')) {
      return {
        code: this.errorCodes.NETWORK_ERROR,
        userMessage: '🌐 Network connection issue. Please check your internet and try again.',
        retryable: true,
        severity: 'high'
      };
    }
    
    if (message.includes('rpc error') || message.includes('json rpc')) {
      return {
        code: this.errorCodes.RPC_ERROR,
        userMessage: '🔗 Blockchain network is temporarily unavailable. Please try again in a few minutes.',
        retryable: true,
        severity: 'high'
      };
    }
    
    // Input Validation Errors
    if (message.includes('invalid amount') || message.includes('amount must be')) {
      return {
        code: this.errorCodes.INVALID_AMOUNT,
        userMessage: '💱 Invalid amount. Please enter a valid number greater than 0.',
        retryable: false,
        severity: 'low'
      };
    }
    
    if (message.includes('invalid command') || message.includes('command not recognized')) {
      return {
        code: this.errorCodes.INVALID_COMMAND,
        userMessage: '❓ Command not recognized. Type "help" to see available commands.',
        retryable: false,
        severity: 'low'
      };
    }
    
    // Service Errors
    if (message.includes('privy') || message.includes('authentication failed')) {
      return {
        code: this.errorCodes.PRIVY_ERROR,
        userMessage: '🔐 Authentication service temporarily unavailable. Please try again in a few minutes.',
        retryable: true,
        severity: 'high'
      };
    }
    
    if (message.includes('nebula') || message.includes('thirdweb')) {
      return {
        code: this.errorCodes.NEBULA_ERROR,
        userMessage: '🔗 Blockchain service temporarily unavailable. Please try again in a few minutes.',
        retryable: true,
        severity: 'high'
      };
    }
    
    if (message.includes('database') || message.includes('mongodb')) {
      return {
        code: this.errorCodes.DATABASE_ERROR,
        userMessage: '💾 Database temporarily unavailable. Please try again in a few minutes.',
        retryable: true,
        severity: 'high'
      };
    }
    
    // Rate Limiting
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return {
        code: this.errorCodes.RATE_LIMIT_EXCEEDED,
        userMessage: '⚡ Too many requests. Please wait a moment before trying again.',
        retryable: true,
        severity: 'medium'
      };
    }
    
    // Default Internal Error
    return {
      code: this.errorCodes.INTERNAL_ERROR,
      userMessage: '🔧 Something went wrong. Our team has been notified. Please try again in a few minutes.',
      retryable: true,
      severity: 'high'
    };
  }

  /**
   * Create retry mechanism for retryable errors
   */
  async withRetry(operation, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const errorInfo = this.handleError(error);
        
        if (!errorInfo.retryable || attempt === maxRetries) {
          throw error;
        }
        
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        logger.warn(`Attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Format error message for WhatsApp display
   */
  formatErrorMessage(errorInfo, includeCode = false) {
    let message = errorInfo.userMessage;
    
    if (includeCode) {
      message += `\n\n🔍 Error Code: ${errorInfo.code}`;
    }
    
    if (errorInfo.retryable) {
      message += '\n\n🔄 You can try this action again.';
    }
    
    return message;
  }
}

module.exports = new ErrorHandler();
