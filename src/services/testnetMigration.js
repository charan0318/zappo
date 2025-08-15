const { logger } = require('../utils/logger');
const config = require('../config');

class TestnetMigrationService {
  constructor() {
    this.mainnetDb = null;
    this.testnetDb = null;
  }

  // Initialize connections to both databases
  async initialize() {
    try {
      const { MongoClient } = require('mongodb');
      
      // Connect to mainnet database
      this.mainnetClient = new MongoClient(config.database.uri, config.database.options);
      await this.mainnetClient.connect();
      this.mainnetDb = this.mainnetClient.db();
      
      // Connect to testnet database (current connection)
      this.testnetClient = new MongoClient(config.database.testnetUri, config.database.options);
      await this.testnetClient.connect();
      this.testnetDb = this.testnetClient.db();
      
      logger.info('✅ Migration service initialized - connected to both mainnet and testnet databases');
      
    } catch (error) {
      logger.error('❌ Failed to initialize migration service:', error);
      throw error;
    }
  }

  // Check if user exists in mainnet database
  async isMainnetUser(phone) {
    try {
      if (!this.mainnetDb) {
        await this.initialize();
      }
      
      const user = await this.mainnetDb.collection('users').findOne({ phone });
      return !!user;
      
    } catch (error) {
      logger.error('Error checking mainnet user:', error);
      return false;
    }
  }

  // Get mainnet user details
  async getMainnetUser(phone) {
    try {
      if (!this.mainnetDb) {
        await this.initialize();
      }
      
      const user = await this.mainnetDb.collection('users').findOne({ phone });
      return user;
      
    } catch (error) {
      logger.error('Error getting mainnet user:', error);
      return null;
    }
  }

  // Create testnet user entry with mainnet reference
  async createTestnetUser(phone, newWalletData) {
    try {
      if (!this.testnetDb) {
        await this.initialize();
      }

      const testnetUser = {
        ...newWalletData,
        phone,
        mainnet_migrated: true,
        migration_date: new Date(),
        testnet_created: true
      };

      await this.testnetDb.collection('users').insertOne(testnetUser);
      logger.info(`✅ Created testnet user for ${phone}`);
      
      return testnetUser;
      
    } catch (error) {
      logger.error('Error creating testnet user:', error);
      throw error;
    }
  }

  // Generate welcome message for existing mainnet users
  generateMainnetUserWelcome(mainnetUser) {
    return `🏦 *Welcome back to ZAPPO!*

🔄 *Testnet Mode Active*

Your mainnet wallet is safe and will be restored when we return to mainnet. For now, let's explore ZAPPO on testnet!

📊 *Your Mainnet Wallet:*
• Address: \`${mainnetUser.wallet_address}\`
• This wallet is preserved and secure

🧪 *New Testnet Features:*
• Try transactions without real money
• Test claim links with friends
• Explore new features safely

💧 *Get Testnet AVAX:*
🔗 [Free Testnet Faucet](https://faucet.avax.network/)

Ready to create your testnet wallet? Type "create wallet" to begin!

💡 *Note:* Your mainnet funds are safe and will be available when we switch back to mainnet.`;
  }

  // Close database connections
  async close() {
    try {
      if (this.mainnetClient) {
        await this.mainnetClient.close();
      }
      if (this.testnetClient) {
        await this.testnetClient.close();
      }
      logger.info('Migration service connections closed');
    } catch (error) {
      logger.error('Error closing migration service:', error);
    }
  }
}

module.exports = new TestnetMigrationService();
