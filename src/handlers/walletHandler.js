const privyService = require('../services/privy');
const avaxProvider = require('../services/nebula');
const { users } = require('../services/database');
const { logger, logUserAction } = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const errorRecovery = require('../utils/errorRecovery');
const testnetMigration = require('../services/testnetMigration');

class WalletHandler {
  // Create new wallet for user
  async createWallet(phone) {
    try {
      logger.info(`Creating wallet for phone: ${phone}`);
      
      // Check if user already exists in testnet database
      const existingUser = await users.findUserByPhone(phone);
      if (existingUser) {
        return {
          success: false,
          error: 'User already has a testnet wallet'
        };
      }
      
      // Check if user exists in mainnet database
      const isMainnetUser = await testnetMigration.isMainnetUser(phone);
      let mainnetUserData = null;
      
      if (isMainnetUser) {
        mainnetUserData = await testnetMigration.getMainnetUser(phone);
        logger.info(`Found mainnet user: ${phone}, creating testnet wallet`);
      }
      
      // Create wallet using Privy
      const walletResult = await privyService.createWallet(phone);
      
      if (!walletResult.success) {
        return walletResult;
      }
      
      // Save user to testnet database
      const userData = {
        phone: phone,
        wallet_address: walletResult.walletAddress,
        privy_wallet_id: walletResult.privyWalletId,
        private_key: walletResult.privateKey,
        chain_type: walletResult.chainType,
        is_imported: false,
        // Migration tracking
        mainnet_migrated: isMainnetUser,
        mainnet_address: isMainnetUser ? mainnetUserData?.wallet_address : null,
        migration_date: isMainnetUser ? new Date() : null,
        testnet_created: true
      };
      
      await users.createUser(userData);
      
      logUserAction(phone, 'wallet_created', { 
        address: walletResult.walletAddress,
        mainnet_user: isMainnetUser,
        mainnet_address: mainnetUserData?.wallet_address
      });
      
      return {
        success: true,
        walletAddress: walletResult.walletAddress,
        balance: '0',
        isMainnetUser,
        mainnetAddress: mainnetUserData?.wallet_address
      };
      
    } catch (error) {
      logger.error('Error creating wallet:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Import existing wallet
  async importWallet(phone, privateKey) {
    try {
      logger.info(`Importing wallet for phone: ${phone}`);
      
      // Check if user already exists
      const existingUser = await users.findUserByPhone(phone);
      if (existingUser) {
        return {
          success: false,
          error: 'User already has a wallet'
        };
      }
      
      // Import wallet using Privy
      const walletResult = await privyService.importWallet(phone, privateKey);
      
      if (!walletResult.success) {
        return walletResult;
      }
      
      // Get current balance
      const balanceResult = await avaxProvider.getBalance(walletResult.walletAddress);
      
      // Save user to database
      const userData = {
        phone: phone,
        wallet_address: walletResult.walletAddress,
        privy_wallet_id: walletResult.privyWalletId,
        private_key: walletResult.privateKey,
        chain_type: walletResult.chainType,
        is_imported: walletResult.isImported || false
      };
      
      await users.createUser(userData);
      
      logUserAction(phone, 'wallet_imported', { address: walletResult.walletAddress });
      
      return {
        success: true,
        walletAddress: walletResult.walletAddress,
        balance: balanceResult.toString()
      };
      
    } catch (error) {
      logger.error('Error importing wallet:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Handle backup request
  async handleBackup(from, phone) {
    try {
      // Get user from database
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, 'You don’t have a wallet yet. Would you like me to create one for you now, or do you want to import an existing one?');
        return;
      }
      
      // Decrypt and get private key (only for imported wallets)
      const backupResult = await privyService.backupWallet(user.private_key, user.is_imported);
      
      if (!backupResult.success) {
        await this.sendMessage(from, `❌ Failed to backup wallet: ${backupResult.error}`);
        return;
      }
      
      // Send private key to user
      await this.sendMessage(from, `Wallet backup

Address: \`${backupResult.address}\`
Private key: \`${backupResult.privateKey}\`

Important:
- Keep this key private. Anyone with it can access your funds.
- Store it securely offline.
- Never share it with anyone.`);
      
      logUserAction(phone, 'wallet_backed_up', { address: backupResult.address });
      
    } catch (error) {
      logger.error('Error handling backup:', error);
      await this.sendMessage(from, `❌ Error backing up wallet: ${error.message}`);
    }
  }
  
  // Get user wallet info
  async getUserWallet(phone) {
    try {
      const user = await users.findUserByPhone(phone);
      if (!user) {
        return null;
      }
      
      // Get current balance
      const balanceResult = await avaxProvider.getBalance(user.wallet_address);
      
      return {
        phone: user.phone,
        address: user.wallet_address,
        balance: balanceResult.toString(),
        private_key: user.private_key,
        privy_wallet_id: user.privy_wallet_id,
        is_imported: user.is_imported
      };
      
    } catch (error) {
      logger.error('Error getting user wallet:', error);
      return null;
    }
  }
  
  // Validate user has wallet
  async validateUserWallet(phone) {
    try {
      const user = await users.findUserByPhone(phone);
      return user !== null;
    } catch (error) {
      logger.error('Error validating user wallet:', error);
      return false;
    }
  }
  
  // Get wallet provider for transactions
  async getWalletProvider(phone) {
    try {
      const user = await users.findUserByPhone(phone);
      if (!user) {
        throw new Error('User not found');
      }
      
      // Validate essential wallet data
      if (!user.wallet_address) {
        throw new Error('User wallet address missing');
      }
      
      // Handle wallet corruption scenarios
      if (!user.is_imported && !user.privy_wallet_id) {
        logger.warn(`Privy wallet missing privy_wallet_id for user ${phone}, treating as corrupted`);
        throw new Error('Wallet data corrupted - missing Privy ID');
      }
      
      return await privyService.getWalletProvider(
        user.private_key,
        user.is_imported,
        user.privy_wallet_id
      );
      
    } catch (error) {
      logger.error(`Error getting wallet provider for ${phone}:`, error);
      
      // Provide actionable error for corrupted wallets
      if (error.message.includes('corrupted')) {
        throw new Error('Your wallet data is corrupted. Please backup your private key and import your wallet again.');
      }
      
      throw error;
    }
  }
  
  // Update user wallet info
  async updateUserWallet(phone, updateData) {
    try {
      await users.updateUser(phone, updateData);
      return { success: true };
    } catch (error) {
      logger.error('Error updating user wallet:', error);
      return { success: false, error: error.message };
    }
  }
  
  // Delete user wallet (for testing/reset)
  async deleteUserWallet(phone) {
    try {
      await users.deleteUser(phone);
      logUserAction(phone, 'wallet_deleted');
      return { success: true };
    } catch (error) {
      logger.error('Error deleting user wallet:', error);
      return { success: false, error: error.message };
    }
  }
  
  // Send message helper (this should be injected from command handler)
  async sendMessage(to, message) {
    // This will be overridden by the command handler
    console.log(`[WALLET] ${to}: ${message}`);
  }
}

module.exports = new WalletHandler();
