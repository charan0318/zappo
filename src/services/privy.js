const { PrivyClient } = require('@privy-io/server-auth');
const { ethers } = require('ethers');
const crypto = require('crypto');
const config = require('../config');
const { logger } = require('../utils/logger');

class PrivyService {
  constructor() {
    this.client = new PrivyClient(config.privy.appId, config.privy.appSecret);
  }
  
  // Encrypt private key for storage
  encryptPrivateKey(privateKey) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(config.security.encryptionKey, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(privateKey, 'utf8')),
      cipher.final()
    ]).toString('hex');
    return { encrypted, iv: iv.toString('hex') };
  }
  
  // Decrypt private key for use
  decryptPrivateKey(encryptedData) {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(config.security.encryptionKey, 'salt', 32);
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedData.encrypted, 'hex')),
      decipher.final()
    ]).toString('utf8');
    return decrypted;
  }
  
  // Create new wallet using Privy
  async createWallet(phoneNumber) {
    try {
      logger.info(`Creating new wallet for phone: ${phoneNumber}`);
      
      // Create a server-managed wallet using Privy's walletApi
      const walletResult = await this.client.walletApi.create({ 
        chainType: 'ethereum' 
      });
      
      // Encrypt the wallet ID for storage (Privy manages the private key)
      const encryptedWalletId = this.encryptPrivateKey(walletResult.id);
      
      return {
        privyWalletId: walletResult.id,
        walletAddress: walletResult.address,
        privateKey: encryptedWalletId, // This is actually the encrypted wallet ID
        chainType: walletResult.chainType,
        success: true
      };
      
    } catch (error) {
      logger.error('Error creating wallet with Privy:', error);
      throw new Error(`Failed to create wallet: ${error.message}`);
    }
  }
  
  // Import existing wallet
  async importWallet(phoneNumber, privateKey) {
    try {
      logger.info(`Importing wallet for phone: ${phoneNumber}`);
      
      // Validate private key
      if (!ethers.utils.isHexString(privateKey, 32)) {
        throw new Error('Invalid private key format');
      }
      
      // Create wallet from private key to get address
      const wallet = new ethers.Wallet(privateKey);
      
      // For imported wallets, we'll store the private key directly (encrypted)
      // since Privy's server wallets are managed differently
      const encryptedKey = this.encryptPrivateKey(privateKey);
      
      return {
        privyWalletId: null, // No Privy wallet ID for imported wallets
        walletAddress: wallet.address,
        privateKey: encryptedKey,
        chainType: 'ethereum',
        isImported: true,
        success: true
      };
      
    } catch (error) {
      logger.error('Error importing wallet:', error);
      throw new Error(`Failed to import wallet: ${error.message}`);
    }
  }
  
  // Get wallet by Privy wallet ID (for server-managed wallets)
  async getWallet(privyWalletId) {
    try {
      if (!privyWalletId) {
        return null;
      }
      
      // For server-managed wallets, we can get wallet info from Privy
      // This is a placeholder - actual implementation depends on Privy's API
      return {
        id: privyWalletId,
        address: null, // Would be populated from Privy
        chainType: 'ethereum'
      };
    } catch (error) {
      logger.error('Error getting wallet from Privy:', error);
      throw new Error(`Failed to get wallet: ${error.message}`);
    }
  }
  
  // Backup wallet (return decrypted private key for imported wallets)
  async backupWallet(encryptedData, isImported = false) {
    try {
      if (!isImported) {
        throw new Error('Backup is only available for imported wallets. Server-managed wallets are secured by Privy.');
      }
      
      const privateKey = this.decryptPrivateKey(encryptedData);
      
      // Validate the private key
      const wallet = new ethers.Wallet(privateKey);
      
      return {
        privateKey: privateKey,
        address: wallet.address,
        success: true
      };
      
    } catch (error) {
      logger.error('Error backing up wallet:', error);
      throw new Error(`Failed to backup wallet: ${error.message}`);
    }
  }
  
  // Get wallet provider for transactions
  async getWalletProvider(encryptedData, isImported = false, privyWalletId = null) {
    try {
      // Handle corrupted wallet data - neither private key nor Privy ID
      if (!encryptedData && !privyWalletId) {
        throw new Error('Wallet data is corrupted. No private key or Privy wallet ID found. Please recreate your wallet.');
      }

      // If we have encrypted data but no Privy ID, treat as imported wallet
      if (encryptedData && !privyWalletId) {
        logger.info('Wallet has encrypted data but no Privy ID, treating as imported wallet');
        isImported = true;
      }

      // If we have Privy ID but no encrypted data, it's definitely a Privy wallet
      if (!encryptedData && privyWalletId) {
        logger.info('Wallet has Privy ID but no private key, treating as Privy wallet');
        isImported = false;
      }
      
      if (isImported && encryptedData) {
        // For imported wallets, decrypt the private key and create ethers wallet
        try {
          const privateKey = this.decryptPrivateKey(encryptedData);
          const wallet = new ethers.Wallet(privateKey);
          
          // Create provider for AVAX C-Chain
          const provider = new ethers.providers.JsonRpcProvider(config.thirdweb.rpcUrl);
          
          return wallet.connect(provider);
        } catch (decryptError) {
          logger.error('Failed to decrypt private key:', decryptError);
          throw new Error('Failed to decrypt wallet private key. Wallet may be corrupted.');
        }
      } else {
        // For Privy server-managed wallets, we need a valid Privy wallet ID
        if (!privyWalletId) {
          throw new Error('No Privy wallet ID available. Wallet may need to be recreated.');
        }
        
        // For Privy server-managed wallets, we need to use Privy's signing methods
        // This returns a special wallet object that uses Privy for signing
        return {
          isPrivyWallet: true,
          walletId: privyWalletId,
          privyClient: this.client,
          // We'll implement signing methods as needed
          signTransaction: async (transaction) => {
            return await this.client.walletApi.ethereum.signTransaction({
              walletId: privyWalletId,
              transaction: transaction
            });
          },
          sendTransaction: async (transaction) => {
            // Convert transaction format for Privy API
            const privyTransaction = {
              to: transaction.to,
              value: ethers.utils.hexlify(transaction.value), // Proper conversion for BigNumber
              gas_limit: `0x${(transaction.gasLimit || 21000).toString(16)}`,
              gas_price: ethers.utils.hexlify(transaction.gasPrice), // Proper conversion for BigNumber
              chain_id: transaction.chainId || 43113 // Avalanche Fuji Testnet
            };
            
            logger.info(`Sending Privy transaction:`, privyTransaction);
            
            return await this.client.walletApi.ethereum.sendTransaction({
              walletId: privyWalletId,
              caip2: 'eip155:43113', // Required: Avalanche Fuji Testnet
              transaction: privyTransaction
            });
          }
        };
      }
    } catch (error) {
      logger.error('Error getting wallet provider:', error);
      throw new Error(`Failed to get wallet provider: ${error.message}`);
    }
  }
  
  // Validate wallet address
  validateAddress(address) {
    try {
      return ethers.utils.isAddress(address);
    } catch (error) {
      return false;
    }
  }
  
  // Send transaction directly using Privy
  async sendTransaction(userWallet, toAddress, amountInAvax) {
    try {
      logger.info(`Privy sendTransaction: ${amountInAvax} AVAX to ${toAddress}`);
      
      if (!userWallet.privy_wallet_id) {
        throw new Error('No Privy wallet ID found for user');
      }
      
      // Convert AVAX amount to Wei (18 decimals)
      const { ethers } = require('ethers');
      const amountInWei = ethers.utils.parseEther(amountInAvax.toString());
      
      // Get current gas price for fee estimation
      const provider = new ethers.providers.JsonRpcProvider(config.thirdweb.rpcUrl);
      const feeData = await provider.getFeeData();
      const gasLimit = 21000; // Standard ETH transfer gas limit
      
      // Prepare transaction for Privy API
      const transaction = {
        to: toAddress,
        value: `0x${amountInWei.toHexString().slice(2)}`, // Remove 0x prefix and re-add
        gas_limit: `0x${gasLimit.toString(16)}`,
        gas_price: feeData.gasPrice.toHexString(),
        chain_id: 43113 // Avalanche Fuji Testnet
      };
      
      logger.info(`Sending Privy transaction:`, transaction);
      
      // Send transaction via Privy API
      const result = await this.client.walletApi.ethereum.sendTransaction({
        walletId: userWallet.privy_wallet_id,
        caip2: 'eip155:43113', // Avalanche Fuji Testnet
        transaction: transaction
      });
      
      logger.info(`Privy transaction sent successfully: ${result.transactionHash}`);
      
      return {
        hash: result.transactionHash,
        from: userWallet.address,
        to: toAddress,
        value: amountInAvax,
        gasLimit: gasLimit,
        gasPrice: feeData.gasPrice.toString(),
        nonce: result.nonce || 0
      };
      
    } catch (error) {
      logger.error('Error sending transaction via Privy:', error);
      throw new Error(`Failed to send transaction: ${error.message}`);
    }
  }
  
  // Format address for display
  formatAddress(address) {
    if (!this.validateAddress(address)) {
      throw new Error('Invalid address');
    }
    
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
}

module.exports = new PrivyService();
