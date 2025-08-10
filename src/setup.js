#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🚀 ZAPPO WhatsApp AVAX Wallet Bot - Setup\n');

async function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setup() {
  try {
    console.log('📋 This setup will help you configure ZAPPO for first use.\n');
    
    // Check if .env already exists
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const overwrite = await question('⚠️  .env file already exists. Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('❌ Setup cancelled.');
        process.exit(0);
      }
    }
    
    console.log('\n🔧 Configuration Setup:\n');
    
    // Database configuration
    console.log('📊 Database Configuration:');
    const mongoUri = await question('MongoDB URI (default: mongodb://localhost:27017/zappo): ') || 'mongodb://localhost:27017/zappo';
    
    // Privy configuration
    console.log('\n🔐 Privy Configuration:');
    console.log('Get these from: https://console.privy.io/');
    const privyAppId = await question('Privy App ID: ');
    const privyAppSecret = await question('Privy App Secret: ');
    
    // Thirdweb configuration
    console.log('\n🌐 Thirdweb/Nebula Configuration:');
    console.log('Get these from: https://portal.thirdweb.com/');
    const thirdwebClientId = await question('Thirdweb Client ID: ');
    const thirdwebClientSecret = await question('Thirdweb Client Secret: ');
    
    // Security configuration
    console.log('\n🔒 Security Configuration:');
    const generateKeys = await question('Generate secure encryption keys automatically? (Y/n): ');
    
    let encryptionKey, jwtSecret;
    
    if (generateKeys.toLowerCase() !== 'n') {
      encryptionKey = crypto.randomBytes(32).toString('hex');
      jwtSecret = crypto.randomBytes(32).toString('hex');
      console.log('✅ Generated secure encryption keys');
    } else {
      encryptionKey = await question('Encryption Key (32 characters): ');
      jwtSecret = await question('JWT Secret: ');
    }
    
    // Logging configuration
    console.log('\n📝 Logging Configuration:');
    const logLevel = await question('Log Level (default: info): ') || 'info';
    const nodeEnv = await question('Node Environment (default: development): ') || 'development';
    
    // Create .env file
    const envContent = `# ZAPPO WhatsApp AVAX Wallet Bot - Environment Configuration

# Database Configuration
MONGODB_URI=${mongoUri}

# Privy Configuration
PRIVY_APP_ID=${privyAppId}
PRIVY_APP_SECRET=${privyAppSecret}

# Thirdweb/Nebula Configuration
THIRDWEB_CLIENT_ID=${thirdwebClientId}
THIRDWEB_CLIENT_SECRET=${thirdwebClientSecret}

# Security Configuration
ENCRYPTION_KEY=${encryptionKey}
JWT_SECRET=${jwtSecret}

# Logging Configuration
LOG_LEVEL=${logLevel}
NODE_ENV=${nodeEnv}

# Optional: Custom RPC URL for AVAX C-Chain
# AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc
`;
    
    fs.writeFileSync(envPath, envContent);
    
    console.log('\n✅ Configuration saved to .env file!');
    
    // Create necessary directories
    const dirs = ['logs', 'auth'];
    for (const dir of dirs) {
      const dirPath = path.join(process.cwd(), dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    }
    
    console.log('\n🎉 Setup completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Install dependencies: npm install');
    console.log('2. Start the bot: npm start');
    console.log('3. Scan the QR code with WhatsApp');
    console.log('4. Test with: /help');
    
    console.log('\n⚠️  Important Notes:');
    console.log('• Keep your .env file secure and never commit it to version control');
    console.log('• Make sure MongoDB is running');
    console.log('• Ensure you have valid Privy and Thirdweb credentials');
    console.log('• The bot will create a WhatsApp session in the auth/ directory');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Run setup
setup();
