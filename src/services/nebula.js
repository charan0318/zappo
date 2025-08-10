const { ethers } = require('ethers');
const config = require('../config');
const { logger } = require('../utils/logger');

class NebulaService {
  constructor() {
    this.provider = null;
    // Initialize provider whenever full wallet features are enabled
    if (!config.features?.nebulaChatOnly) {
      this.initialize();
    } else {
      logger.info('⏭️ Skipping provider init (chat-only mode)');
    }
  }
  
  async initialize() {
    try {
      // Create provider for direct RPC calls (AVAX C-Chain)
      const rpcUrl = process.env.AVAX_RPC_URL || config.thirdweb.rpcUrl;
      this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      logger.info('✅ AVAX provider initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize AVAX provider:', error);
      throw error;
    }
  }
  
  // Get AVAX balance for an address
  async getBalance(address) {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }
      
      const balance = await this.provider.getBalance(address);
      const balanceInAvax = ethers.utils.formatEther(balance);
      
      logger.info(`Balance for ${address}: ${balanceInAvax} AVAX`);
      return {
        balance: balanceInAvax,
        balanceWei: balance.toString(),
        address: address
      };
      
    } catch (error) {
      logger.error('Error getting balance:', error);
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }
  
  // Estimate gas for a transaction
  async estimateGas(from, to, amount) {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }
      
      const amountWei = ethers.utils.parseEther(amount.toString());
      
      const gasEstimate = await this.provider.estimateGas({
        from: from,
        to: to,
        value: amountWei
      });
      
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || ethers.BigNumber.from(0);
      const estimatedGasCost = gasEstimate.mul(gasPrice);
      const estimatedGasCostAvax = ethers.utils.formatEther(estimatedGasCost);
      
      return {
        gasLimit: gasEstimate.toString(),
        gasPrice: gasPrice.toString(),
        estimatedCost: estimatedGasCostAvax,
        estimatedCostWei: estimatedGasCost.toString()
      };
      
    } catch (error) {
      logger.error('Error estimating gas:', error);
      throw new Error(`Failed to estimate gas: ${error.message}`);
    }
  }
  
  // Send AVAX transaction
  async sendTransaction(wallet, to, amount, gasLimit = null) {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }
      
      const amountWei = ethers.utils.parseEther(amount.toString());
      
      // Prepare transaction
      const tx = {
        to: to,
        value: amountWei,
        gasLimit: gasLimit || config.transaction.gasLimit
      };
      
      // Get current gas price
      const feeData = await this.provider.getFeeData();
      tx.gasPrice = feeData.gasPrice;
      
      let transaction;
      
      if (wallet.isPrivyWallet) {
        // For Privy-managed wallets, use Privy's sendTransaction method
        tx.chainId = 43114; // Avalanche C-Chain
        transaction = await wallet.sendTransaction(tx);
        
        logger.info(`Privy transaction sent: ${transaction.hash}`);
        
        return {
          hash: transaction.hash,
          from: transaction.from || 'privy-wallet',
          to: transaction.to || tx.to,
          value: amount,
          gasLimit: tx.gasLimit,
          gasPrice: tx.gasPrice.toString(),
          nonce: transaction.nonce || 0
        };
      } else {
        // For imported wallets, use ethers directly
        transaction = await wallet.sendTransaction(tx);
        
        logger.info(`Transaction sent: ${transaction.hash}`);
        
        return {
          hash: transaction.hash,
          from: transaction.from,
          to: transaction.to,
          value: amount,
          gasLimit: tx.gasLimit,
          gasPrice: tx.gasPrice.toString(),
          nonce: transaction.nonce
        };
      }
      
    } catch (error) {
      logger.error('Error sending transaction:', error);
      throw new Error(`Failed to send transaction: ${error.message}`);
    }
  }
  
  // Get transaction status
  async getTransactionStatus(txHash) {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }
      
      const receipt = await this.provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return { status: 'pending', hash: txHash };
      }
      
      return {
        status: receipt.status === 1 ? 'success' : 'failed',
        hash: txHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        confirmations: receipt.confirmations
      };
      
    } catch (error) {
      logger.error('Error getting transaction status:', error);
      throw new Error(`Failed to get transaction status: ${error.message}`);
    }
  }
  
  // Get transaction details
  async getTransaction(txHash) {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }
      
      const tx = await this.provider.getTransaction(txHash);
      
      if (!tx) {
        throw new Error('Transaction not found');
      }
      
      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: ethers.utils.formatEther(tx.value),
        gasLimit: tx.gasLimit.toString(),
        gasPrice: tx.gasPrice.toString(),
        nonce: tx.nonce,
        blockNumber: tx.blockNumber,
        confirmations: tx.confirmations
      };
      
    } catch (error) {
      logger.error('Error getting transaction:', error);
      throw new Error(`Failed to get transaction: ${error.message}`);
    }
  }
  
  // Get recent transactions for an address
  async getAddressTransactions(address, limit = 10) {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }
      
      // Get current block number
      const currentBlock = await this.provider.getBlockNumber();
      
      const transactions = [];
      
      // Scan recent blocks for transactions involving this address
      for (let i = 0; i < limit * 2; i++) { // Check more blocks to find enough transactions
        const blockNumber = currentBlock - i;
        if (blockNumber < 0) break;
        
        const block = await this.provider.getBlockWithTransactions(blockNumber);
        
        for (const tx of block.transactions) {
          if (tx.from.toLowerCase() === address.toLowerCase() || 
              tx.to?.toLowerCase() === address.toLowerCase()) {
            
            transactions.push({
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
               value: ethers.utils.formatEther(tx.value),
              blockNumber: tx.blockNumber,
              timestamp: block.timestamp,
              type: tx.from.toLowerCase() === address.toLowerCase() ? 'outgoing' : 'incoming'
            });
            
            if (transactions.length >= limit) {
              break;
            }
          }
        }
        
        if (transactions.length >= limit) {
          break;
        }
      }
      
      return transactions;
      
    } catch (error) {
      logger.error('Error getting address transactions:', error);
      throw new Error(`Failed to get address transactions: ${error.message}`);
    }
  }
  
  // Get current gas price
  async getCurrentGasPrice() {
    try {
      if (!this.provider) {
        throw new Error('Provider not initialized');
      }
      
      const feeData = await this.provider.getFeeData();
      const gasPrice2 = feeData.gasPrice || ethers.BigNumber.from(0);
      return {
        gasPrice: gasPrice2.toString(),
        gasPriceGwei: ethers.utils.formatUnits(gasPrice2, 'gwei'),
        maxFeePerGas: feeData.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString()
      };
      
    } catch (error) {
      logger.error('Error getting current gas price:', error);
      throw new Error(`Failed to get gas price: ${error.message}`);
    }
  }
  
  // Validate address
  validateAddress(address) {
    try { return ethers.utils.isAddress(address); } catch (error) { return false; }
  }
  
  // Format AVAX amount
  formatAvax(amountWei) {
    return ethers.utils.formatEther(amountWei);
  }
  
  // Parse AVAX amount to Wei
  parseAvax(amount) {
    return ethers.utils.parseEther(amount.toString());
  }
}

module.exports = new NebulaService();
