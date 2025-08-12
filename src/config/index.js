require('dotenv').config();
const { ServerApiVersion } = require('mongodb');

const config = {
  // WhatsApp Configuration
  whatsapp: {
    sessionPath: './auth_info.json',
    qrCodePath: './qr_code.txt',
    reconnectInterval: 5000,
    maxReconnectAttempts: 10
  },
  
  // Admin Configuration
  adminPhone: process.env.ADMIN_PHONE || '919489042245', // Default to your number
  
  // Database Configuration
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/zappo',
    options: {
      serverApi: { version: ServerApiVersion.v1, strict: false, deprecationErrors: false }
    }
  },
  
  // Privy Configuration
  privy: {
    appId: process.env.PRIVY_APP_ID,
    appSecret: process.env.PRIVY_APP_SECRET,
    baseUrl: 'https://auth.privy.io'
  },
  
  // Thirdweb/Nebula Configuration
  thirdweb: {
    clientId: process.env.THIRDWEB_CLIENT_ID,
    clientSecret: process.env.THIRDWEB_CLIENT_SECRET,
    chainId: 43114, // AVAX C-Chain Mainnet
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc'
  },
  
  // Nebula Chat (Step 1)
  nebula: {
    secretKey: process.env.NEBULA_SECRET_KEY,
    agentId: process.env.NEBULA_AGENT_ID
  },
  
  // Security Configuration
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY || 'your-secret-encryption-key-change-this',
    jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret-change-this'
  },
  
  // Transaction Configuration
  transaction: {
    pollInterval: 30000, // 30 seconds
    gasLimit: 21000,
    maxGasPrice: '50000000000' // 50 gwei
  },

  // Escrow / Claim-link Configuration
  escrow: {
    enabled: true,
    expiryDays: parseInt(process.env.ESCROW_EXPIRY_DAYS || '3', 10),
    botNumber: process.env.BOT_NUMBER || '919489042245',
    claimMinGasBuffer: parseFloat(process.env.CLAIM_MIN_GAS_BUFFER || '0.0005') // Reduced default buffer
  },
  
  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: './logs/zappo.log'
  },
  
  // Feature Flags
  features: {
    enableNotifications: true,
    enableContactSupport: true,
    enableNLP: false, // Start with regex-based parsing
    nebulaChatOnly: false // Enable full wallet features; no longer chat-only
  }
};

// Validate required environment variables (conditional by features)
const requiredEnvVars = [];
if (config.features.nebulaChatOnly) {
  // Chat-only: Nebula key is needed for chat replies
  requiredEnvVars.push('NEBULA_SECRET_KEY');
} else {
  // Full wallet mode: Privy is required for wallet creation/import
  requiredEnvVars.push('PRIVY_APP_ID', 'PRIVY_APP_SECRET');
  // Thirdweb client creds are optional now (provider uses RPC directly)
}
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.warn('⚠️  Missing required environment variables:', missingVars);
  console.warn('Please check your .env file');
}

module.exports = config;
