const privyService = require('../services/privy');
const nebulaService = require('../services/nebula');
const { users } = require('../services/database');
const { logger, logUserAction } = require('../utils/logger');
const errorHandler = require('../utils/errorHandler');
const errorRecovery = require('../utils/errorRecovery');

class WalletHandler {
  // Create new wallet for user
  async createWallet(phone) {
    try {
      logger.info(`Creating wallet for phone: ${phone}`);
      
      // Check if user already exists
      const existingUser = await users.findUserByPhone(phone);
      if (existingUser) {
        return {
          success: false,
          error: 'User already has a wallet'
        };
      }
      
      // Create wallet using Privy
      const walletResult = await privyService.createWallet(phone);
      
      if (!walletResult.success) {
        return walletResult;
      }
      
      // Save user to database
      const userData = {
        phone: phone,
        wallet_address: walletResult.walletAddress,
        privy_wallet_id: walletResult.privyWalletId,
        private_key: walletResult.privateKey,
        chain_type: walletResult.chainType,
        is_imported: false
      };
      
      await users.createUser(userData);
      
      logUserAction(phone, 'wallet_created', { address: walletResult.walletAddress });
      
      return {
        success: true,
        walletAddress: walletResult.walletAddress,
        balance: '0'
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
      const balanceResult = await nebulaService.getBalance(walletResult.walletAddress);
      
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
        balance: balanceResult.balance
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
      const balanceResult = await nebulaService.getBalance(user.wallet_address);
      
      return {
        phone: user.phone,
        address: user.wallet_address,
        balance: balanceResult.balance,
        privyWalletId: user.privy_wallet_id,
        isImported: user.is_imported
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
      
      return await privyService.getWalletProvider(
        user.private_key,
        user.is_imported,
        user.privy_wallet_id
      );
      
    } catch (error) {
      logger.error('Error getting wallet provider:', error);
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
