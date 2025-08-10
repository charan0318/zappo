const axios = require('axios');
const config = require('../config');
const { logger } = require('../utils/logger');

const NEBULA_URL = 'https://nebula-api.thirdweb.com/chat';

async function chat(userId, text, { sessionId } = {}) {
  if (!config.nebula?.secretKey) throw new Error('Missing NEBULA_SECRET_KEY');

  const headers = {
    'Content-Type': 'application/json',
    'x-secret-key': config.nebula.secretKey
  };

  const bodyBase = {
    message: text,
    user_id: userId,
    stream: false,
    // Keep Avalanche C-Chain context enforced as string
    context_filter: { chain_ids: [String(config.thirdweb.chainId || 43114)] },
    ...(config.nebula.agentId ? { agent_id: config.nebula.agentId } : {}),
    ...(sessionId ? { session_id: sessionId } : {})
  };

  const attempt = async (tryNo) => {
    try {
      const { data } = await axios.post(NEBULA_URL, bodyBase, {
        headers,
        timeout: 45000 // increased to reduce false timeouts
      });
      const reply = data.reply || data.choices?.[0]?.message?.content || data.message || '';
      if (!reply) throw new Error('Empty reply from Nebula');
      return reply;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      const code = err.code;
      const msg = err.message || '';

      logger.error('Nebula chat error:', { status, code, msg, data });

      // Retry once on timeout/network/5xx
      const retriable = code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout') || (status && status >= 500);
      if (retriable && tryNo === 1) {
        await new Promise((r) => setTimeout(r, 1200));
        return attempt(2);
      }

      if (status === 429) {
        throw new Error('Rate limit exceeded. Please wait before trying again.');
      }
      if (data?.detail) {
        throw new Error('Invalid request format. Please try again.');
      }
      if (code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout')) {
        throw new Error('Request timed out. Please try again.');
      }

      throw err;
    }
  };

  return attempt(1);
}

module.exports = { chat };



