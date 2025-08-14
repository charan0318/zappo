const { initializeWhatsApp } = require('./services/whatsapp');
const { initializeDatabase } = require('./services/database');
const { initializeLogger } = require('./utils/logger');
const { initializeTransactionPoller } = require('./services/transactionPoller');
const { initializeCommandHandler } = require('./handlers/commandHandler');
const KeepAlive = require('./services/keepAlive');
const config = require('./config');
const express = require('express');

const logger = initializeLogger();
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

async function startZappo() {
  try {
    logger.info('🚀 Starting ZAPPO WhatsApp AVAX Wallet Bot...');

    // Initialize database connection
    logger.info('📊 Connecting to MongoDB...');
    await initializeDatabase();

    // Initialize WhatsApp connection
    logger.info('📱 Initializing WhatsApp connection...');
    const whatsapp = await initializeWhatsApp();

    // Initialize command handler
    logger.info('🧠 Initializing command handler...');
    const commandHandler = initializeCommandHandler(whatsapp);

    // Initialize transaction poller for notifications (skip in chat-only mode)
    if (!config.features?.nebulaChatOnly) {
      logger.info('🔍 Initializing transaction poller...');
      initializeTransactionPoller(whatsapp);
    } else {
      logger.info('⏭️ Skipping transaction poller (chat-only mode)');
    }

    // Start Express server
    const PORT = process.env.PORT || process.env.LOCAL_PORT || 3001;
    app.listen(PORT, "0.0.0.0", () => {
      logger.info(`🌐 Express server running on port ${PORT}`);
      
      // Start keep-alive if on Render or production
      if (process.env.RENDER || process.env.NODE_ENV === 'production') {
        const appUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
        const keepAlive = new KeepAlive(appUrl);
        keepAlive.start();
      }
    });

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
    logger.error('❌ Failed to start ZAPPO:', error);
    process.exit(1);
  }
}

// Start the application
startZappo();

