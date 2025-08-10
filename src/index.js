const { initializeWhatsApp } = require('./services/whatsapp');
const { initializeDatabase } = require('./services/database');
const { initializeLogger } = require('./utils/logger');
const { initializeTransactionPoller } = require('./services/transactionPoller');
const { initializeCommandHandler } = require('./handlers/commandHandler');
const config = require('./config');

const logger = initializeLogger();

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
    
    logger.info('✅ ZAPPO is ready! Listening for messages...');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('🛑 Shutting down ZAPPO...');
      // Do NOT call logout here; we want to keep the session persistent across restarts.
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
