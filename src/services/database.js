const { MongoClient } = require('mongodb');
const config = require('../config');
const { logger } = require('../utils/logger');

let db = null;
let client = null;

const initializeDatabase = async () => {
  try {
    client = new MongoClient(config.database.uri, config.database.options);
    await client.connect();
    db = client.db();
    
    logger.info('✅ Connected to MongoDB successfully');
    
    // Create indexes for better performance
    await createIndexes();
    
    return db;
  } catch (error) {
    logger.error('❌ Failed to connect to MongoDB:', error);
    throw error;
  }
};

const createIndexes = async () => {
  try {
    // Ensure all required collections exist
    const collections = ['users', 'transactions', 'contacts', 'claims'];
    for (const collectionName of collections) {
      try {
        await db.createCollection(collectionName);
        logger.info(`✅ Created collection: ${collectionName}`);
      } catch (error) {
        // Collection already exists, that's fine
        logger.debug(`Collection ${collectionName} already exists`);
      }
    }
    
    // Users collection indexes
    await db.collection('users').createIndex({ phone: 1 }, { unique: true });
    await db.collection('users').createIndex({ wallet_address: 1 }, { unique: true });
    
    // Transactions collection indexes
    await db.collection('transactions').createIndex({ user_phone: 1 });
    await db.collection('transactions').createIndex({ tx_hash: 1 }, { unique: true });
    await db.collection('transactions').createIndex({ timestamp: -1 });
    
    // Contacts collection indexes
    await db.collection('contacts').createIndex({ owner_phone: 1, name: 1 }, { unique: true });
    await db.collection('contacts').createIndex({ owner_phone: 1, address: 1 });

    // Claims collection indexes
    await db.collection('claims').createIndex({ token_hash: 1 }, { unique: true });
    await db.collection('claims').createIndex({ sender_phone: 1 });
    await db.collection('claims').createIndex({ recipient_phone: 1 });
    await db.collection('claims').createIndex({ status: 1, expires_at: 1 });
    
    logger.info('✅ Database indexes created successfully');
  } catch (error) {
    logger.error('❌ Failed to create database indexes:', error);
    throw error;
  }
};

const getCollection = (collectionName) => {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db.collection(collectionName);
};

// User operations
const userOperations = {
  async createUser(userData) {
    const collection = getCollection('users');
    const result = await collection.insertOne({
      ...userData,
      created_at: new Date()
    });
    return result;
  },
  
  async findUserByPhone(phone) {
    const collection = getCollection('users');
    return await collection.findOne({ phone });
  },
  
  async findUserByWalletAddress(walletAddress) {
    const collection = getCollection('users');
    return await collection.findOne({ wallet_address: walletAddress });
  },
  
  async updateUser(phone, updateData) {
    const collection = getCollection('users');
    return await collection.updateOne(
      { phone },
      { $set: { ...updateData, updated_at: new Date() } }
    );
  },
  
  async deleteUser(phone) {
    const collection = getCollection('users');
    return await collection.deleteOne({ phone });
  },
  
  async find(filter = {}) {
    const collection = getCollection('users');
    return await collection.find(filter).toArray();
  }
};

// Claims operations
const claimOperations = {
  async createClaim(claimData) {
    const collection = getCollection('claims');
    const result = await collection.insertOne({
      ...claimData,
      created_at: new Date(),
      updated_at: new Date()
    });
    return result;
  },

  async findByTokenHash(tokenHash) {
    const collection = getCollection('claims');
    return await collection.findOne({ token_hash: tokenHash });
  },

  async findPendingByRecipient(recipientPhone) {
    const collection = getCollection('claims');
    return await collection.find({ recipient_phone: recipientPhone, status: 'pending' }).toArray();
  },

  async updateClaimById(_id, updateData) {
    const collection = getCollection('claims');
    return await collection.updateOne(
      { _id },
      { $set: { ...updateData, updated_at: new Date() } }
    );
  },

  async findExpiringPending(now = new Date()) {
    const collection = getCollection('claims');
    return await collection.find({ status: 'pending', expires_at: { $lte: now } }).toArray();
  },

  async findPendingForReminder(start, end) {
    const collection = getCollection('claims');
    return await collection.find({ status: 'pending', expires_at: { $gt: start, $lte: end } }).toArray();
  }
};

// Transaction operations
const transactionOperations = {
  async createTransaction(txData) {
    const collection = getCollection('transactions');
    const result = await collection.insertOne({
      ...txData,
      timestamp: new Date()
    });
    return result;
  },
  
  async findPendingTransactions(limit = 50) {
    const collection = getCollection('transactions');
    return await collection
      .find({ status: 'pending' })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  },
  
  async findTransactionsByUser(phone, limit = 5) {
    const collection = getCollection('transactions');
    return await collection
      .find({ user_phone: phone })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  },
  
  async findTransactionByHash(txHash) {
    const collection = getCollection('transactions');
    return await collection.findOne({ tx_hash: txHash });
  },
  
  async updateTransactionStatus(txHash, status) {
    const collection = getCollection('transactions');
    return await collection.updateOne(
      { tx_hash: txHash },
      { $set: { status, updated_at: new Date() } }
    );
  },
  
  async getRecentTransactions(limit = 10) {
    const collection = getCollection('transactions');
    return await collection
      .find({})
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  }
};

// Contact operations
const contactOperations = {
  async addContact(ownerPhone, name, address) {
    const collection = getCollection('contacts');
    const result = await collection.insertOne({
      owner_phone: ownerPhone,
      name,
      address,
      created_at: new Date()
    });
    return result;
  },
  
  async findContactByName(ownerPhone, name) {
    const collection = getCollection('contacts');
    return await collection.findOne({ owner_phone: ownerPhone, name });
  },
  
  async findContactByAddress(ownerPhone, address) {
    const collection = getCollection('contacts');
    return await collection.findOne({ owner_phone: ownerPhone, address });
  },
  
  async getAllContacts(ownerPhone) {
    const collection = getCollection('contacts');
    return await collection.find({ owner_phone: ownerPhone }).toArray();
  },
  
  async deleteContact(ownerPhone, name) {
    const collection = getCollection('contacts');
    return await collection.deleteOne({ owner_phone: ownerPhone, name });
  }
};

const closeDatabase = async () => {
  if (client) {
    await client.close();
    logger.info('✅ Database connection closed');
  }
};

module.exports = {
  initializeDatabase,
  closeDatabase,
  getCollection,
  users: userOperations,
  transactions: transactionOperations,
  contacts: contactOperations,
  claims: claimOperations
};
