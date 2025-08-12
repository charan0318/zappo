const axios = require('axios');
const { logger } = require('../utils/logger');

class KeepAlive {
    constructor(appUrl) {
        this.appUrl = appUrl;
        this.interval = null;
    }

    start() {
        // Ping every 10 minutes (before 15-min timeout)
        this.interval = setInterval(() => {
            this.ping();
        }, 10 * 60 * 1000); // 10 minutes
        
        logger.info('✅ Keep-alive service started - pinging every 10 minutes');
    }

    async ping() {
        try {
            const response = await axios.get(${this.appUrl}/health, {
                timeout: 10000 // 10 second timeout
            });
            logger.info(🏓 Keep-alive ping successful - Status: );
        } catch (error) {
            logger.warn(⚠️ Keep-alive ping failed: );
        }
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            logger.info('🛑 Keep-alive service stopped');
        }
    }
}

module.exports = KeepAlive;
