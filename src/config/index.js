require('dotenv').config();
// Load local environment file if it exists (for local development)
require('dotenv').config({ path: '.env.local' });
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
    uri: process.env.MONGODB_URI || (() => { throw new Error('MONGODB_URI environment variable is required') })(),
    testnetUri: process.env.MONGODB_URI_TESTNET || (() => { throw new Error('MONGODB_URI_TESTNET environment variable is required') })(),
    options: {
      // Force proper Atlas SRV handling
      tls: true,
      tlsAllowInvalidCertificates: false,
      
      // SRV-specific options
      srvMaxHosts: 0, // Use all available hosts
      srvServiceName: 'mongodb',
      
      // Timeouts optimized for Atlas
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 0,
      heartbeatFrequencyMS: 10000,
      
      // Connection pool
      maxPoolSize: 10,
      minPoolSize: 1,
      maxIdleTimeMS: 30000,
      
      // Retry configuration
      retryWrites: true,
      retryReads: true,
      
      // Atlas API versioning
      serverApi: { 
        version: ServerApiVersion.v1, 
        strict: false, 
        deprecationErrors: false 
      }
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
    chainId: 43113, // AVAX Fuji Testnet
    rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc'
  },
  
  // Testnet URLs
  testnet: {
    faucetUrl: process.env.FAUCET_URL || 'https://core.app/tools/testnet-faucet',
    explorerUrl: 'https://testnet.snowtrace.io'
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
    enableNotifications: false, // Disabled to stop spam
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

// URL Constants - public URLs that can be hardcoded
config.urls = {
  faucet: 'https://faucet.avax.network/',
  explorer: 'https://testnet.snowtrace.io',
};

module.exports = config;
