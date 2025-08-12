// Global error handlers for debugging
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Debug environment info
console.log('🚀 Starting Zappo WhatsApp Bot...');
console.log('📁 Current directory:', process.cwd());
console.log('📊 Node version:', process.version);
console.log('🔧 Environment variables:', {
  PORT: process.env.PORT,
  MONGO_URI: process.env.MONGO_URI ? 'SET' : 'NOT SET',
  MONGODB_URI: process.env.MONGODB_URI ? 'SET' : 'NOT SET',
  RENDER: process.env.RENDER ? 'YES' : 'NO',
  NODE_ENV: process.env.NODE_ENV || 'development',
  PRIVY_APP_ID: process.env.PRIVY_APP_ID ? 'SET' : 'NOT SET',
  PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET ? 'SET' : 'NOT SET'
});

console.log('📦 Loading modules...');
const { initializeWhatsApp } = require('./services/whatsapp');
console.log('✅ WhatsApp service loaded');

const { initializeDatabase } = require('./services/database');
console.log('✅ Database service loaded');

const { initializeLogger } = require('./utils/logger');
console.log('✅ Logger utils loaded');

const { initializeTransactionPoller } = require('./services/transactionPoller');
console.log('✅ Transaction poller loaded');

const { initializeCommandHandler } = require('./handlers/commandHandler');
console.log('✅ Command handler loaded');

const KeepAlive = require('./services/keepAlive');
console.log('✅ Keep-alive service loaded');

let config;
try {
  config = require('./config');
  console.log('✅ Config loaded successfully');
} catch (error) {
  console.error('❌ Failed to load config:', error);
  process.exit(1);
}

const express = require('express');
console.log('✅ Express loaded');

console.log('✅ All modules imported successfully');
let logger;
try {
  logger = initializeLogger();
  console.log('✅ Logger initialized');
} catch (error) {
  console.error('❌ Failed to initialize logger:', error);
  console.log('⚠️ Continuing without logger...');
  // Create a basic console logger fallback
  logger = {
    info: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.log
  };
}
const app = express();

// Health check endpoint for keep-alive
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'ZAPPO WhatsApp Bot'
  });
});

// Basic info endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'ZAPPO WhatsApp AVAX Wallet Bot',
    status: 'Running',
    version: '1.0.0'
  });
});

// QR Code endpoint - GENIUS IDEA! 
app.get('/qr', (req, res) => {
  // Simple version - just show instruction to check logs for now
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>ZAPPO WhatsApp QR Code</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 20px; background: #f0f0f0; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }
            .instructions { background: #e7f3ff; padding: 15px; border-radius: 8px; margin: 20px 0; }
            .logs-section { background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #25D366; }
            h1 { color: #25D366; }
            .refresh-btn { background: #25D366; color: white; padding: 10px 20px; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; margin: 10px; }
            .refresh-btn:hover { background: #1fa855; }
            code { background: #f1f1f1; padding: 2px 6px; border-radius: 3px; }
        </style>
        <script>
            // Auto-refresh every 10 seconds
            setTimeout(() => window.location.reload(), 10000);
        </script>
    </head>
    <body>
        <div class="container">
            <h1>🤖 ZAPPO WhatsApp Bot</h1>
            <h2>📱 QR Code Authentication</h2>
            
            <div class="instructions">
                <strong>📋 How to Get QR Code:</strong><br>
                1. Check your Render deployment logs<br>
                2. Look for the QR code text between the === lines<br>
                3. Copy the long text string (starts with 2@...)<br>
                4. Paste it into <a href="https://qr-code-generator.com/" target="_blank">QR Generator</a><br>
                5. Scan the generated QR with WhatsApp
            </div>
            
            <div class="logs-section">
                <h3>📊 Where to Find QR Code:</h3>
                <p>Go to your Render dashboard → Logs → Look for:</p>
                <code>� QR CODE FOR WHATSAPP AUTHENTICATION:</code><br>
                <code>2@ABC123XYZ... (long string)</code>
            </div>
            
            <div class="instructions">
                <strong>⏰ QR Code expires every 20 seconds</strong><br>
                Fresh QR codes generate automatically every 30 seconds
            </div>
            
            <button class="refresh-btn" onclick="window.location.reload()">🔄 Refresh Page</button>
            
            <p><small>This page auto-refreshes every 10 seconds</small></p>
        </div>
    </body>
    </html>
  `);
});

async function startZappo() {
  try {
    console.log('🚀 Starting ZAPPO WhatsApp AVAX Wallet Bot...');
    logger.info('🚀 Starting ZAPPO WhatsApp AVAX Wallet Bot...');

    // Initialize database connection
    console.log('📊 Connecting to MongoDB...');
    logger.info('📊 Connecting to MongoDB...');
    await initializeDatabase();
    console.log('✅ Database connected successfully');

    // Initialize WhatsApp connection
    console.log('📱 Initializing WhatsApp connection...');
    logger.info('📱 Initializing WhatsApp connection...');
    const whatsapp = await initializeWhatsApp();
    console.log('✅ WhatsApp connection established');

    // Initialize command handler
    console.log('🧠 Initializing command handler...');
    logger.info('🧠 Initializing command handler...');
    const commandHandler = initializeCommandHandler(whatsapp);
    console.log('✅ Command handler ready');

    // Initialize transaction poller for notifications (skip in chat-only mode)
    if (!config.features?.nebulaChatOnly) {
      console.log('🔍 Initializing transaction poller...');
      logger.info('🔍 Initializing transaction poller...');
      initializeTransactionPoller(whatsapp);
      console.log('✅ Transaction poller ready');
    } else {
      console.log('⏭️ Skipping transaction poller (chat-only mode)');
      logger.info('⏭️ Skipping transaction poller (chat-only mode)');
    }

    // Start Express server
    const PORT = process.env.PORT || 3000;
    console.log(`🌐 Starting Express server on port ${PORT}...`);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🌐 Express server running on port ${PORT}`);
      logger.info(`🌐 Express server running on port ${PORT}`);
      
      // Start keep-alive if on Render or production
      if (process.env.RENDER || process.env.NODE_ENV === 'production') {
        console.log('🔄 Starting keep-alive service...');
        const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const keepAlive = new KeepAlive(appUrl);
        keepAlive.start();
        console.log('✅ Keep-alive service started');
      }
    });

    console.log('✅ ZAPPO is ready! Listening for messages...');
    logger.info('✅ ZAPPO is ready! Listening for messages...');

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('🛑 Shutting down ZAPPO...');
      try {
        if (whatsapp?.end) {
          await whatsapp.end();
        }
      } catch (e) {
        logger.warn('Graceful end skipped:', e?.message || e);
      } finally {
        process.exit(0);
      }
    });

  } catch (error) {
    console.error('❌ Failed to start ZAPPO:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    logger.error('❌ Failed to start ZAPPO:', error);
    process.exit(1);
  }
}

// Start the application with error handling
console.log('🎯 Calling startZappo function...');
startZappo().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});

