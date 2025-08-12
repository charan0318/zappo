const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { Boom } = require('@hapi/boom');
const dns = require('dns').promises;
const config = require('../config');
const { logger, logWhatsAppEvent } = require('../utils/logger');
const { EventEmitter } = require('events');

let sock = null;
let reconnectAttempts = 0;
let isConnecting = false;
let isConnected = false;
let conflictCount = 0;
const MAX_CONFLICT_ATTEMPTS = 5;
const appEvents = new EventEmitter();
const messageQueue = [];
let networkBackoffMs = 5000;
const MAX_NETWORK_BACKOFF_MS = 5 * 60 * 1000;

// SOLUTION: Track server startup time to ignore old messages
const SERVER_START_TIME = Math.floor(Date.now() / 1000); // Unix timestamp in seconds

// Store current QR code for web endpoint
let currentQRCode = null;
let qrGeneratedAt = null;

// Clear WhatsApp sessions when needed
async function clearAllWhatsAppSessions() {
  try {
    // Remove auth directory if exists
    if (fs.existsSync('auth')) {
      fs.rmSync('auth', { recursive: true, force: true });
    }
    
    // Clear any session files
    const sessionFiles = ['session.json', 'session.json.backup'];
    for (const file of sessionFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
  } catch (error) {
    logger.warn('⚠️ Could not clear sessions:', error.message);
  }
}

async function waitForWhatsAppDNS() {
  while (true) {
    try {
      await dns.resolve('web.whatsapp.com');
      return true;
    } catch (e) {
      logger.warn('🌐 DNS not resolved for web.whatsapp.com yet; retrying in 5s');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const initializeWhatsApp = async () => {
  try {
    if (isConnecting) {
      logger.info('🔄 WhatsApp connection already in progress...');
      return sock;
    }
    
    isConnecting = true;
    logger.info('📱 Initializing WhatsApp connection...');
    
    // Clear sessions only if we've had conflicts
    if (conflictCount >= MAX_CONFLICT_ATTEMPTS) {
      logger.warn('🚨 Too many conflicts detected. Clearing sessions...');
      await clearAllWhatsAppSessions();
      conflictCount = 0;
      reconnectAttempts = 0;
    }
    
    // Ensure auth directory exists
    const authDir = path.dirname(config.whatsapp.sessionPath);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    
    // Load or create auth state
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    
    // Ensure DNS is resolvable before attempting connection
    await waitForWhatsAppDNS();

    // Use latest supported WA Web version
    const { version } = await fetchLatestBaileysVersion();

    // Create WhatsApp socket with conflict prevention settings
    sock = makeWASocket({
      auth: state,
      version,
      // FIXED: Use unique browser fingerprint to avoid conflicts
      browser: ['ZAPPO', 'Chrome', `${Date.now()}`],
      // CRITICAL: Disable features that cause conflicts
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      // Optimized timeouts
      defaultQueryTimeoutMs: 60000,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      // Message handling optimization
      getMessage: async () => undefined,
      generateHighQualityLinkPreview: false,
      // CRITICAL: Add unique device ID
      deviceId: `zappo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    });

    // Set up credentials saving
    sock.ev.on('creds.update', saveCreds);
    
    // Bridge custom app events API
    sock.on = (eventName, handler) => appEvents.on(eventName, handler);
    
    // Handle connection updates with improved conflict resolution
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        // Store QR code for web endpoint
        currentQRCode = qr;
        qrGeneratedAt = Date.now();
        
        logger.info('📱 QR Code generated - please scan with WhatsApp');
        
        // Log QR code as copyable text for server environments
        console.log('='.repeat(60));
        console.log('📱 QR CODE FOR WHATSAPP AUTHENTICATION:');
        console.log('='.repeat(60));
        console.log(qr);
        console.log('='.repeat(60));
        console.log('📋 COPY THE TEXT ABOVE AND PASTE IT INTO:');
        console.log('🔗 https://qr-code-generator.com/');
        console.log('🔗 https://www.qr-code-generator.org/');
        console.log('📱 Then scan the generated QR with WhatsApp IMMEDIATELY');
        console.log('⏰ QR Code expires in 20 seconds');
        console.log('🔄 Fresh QR will auto-generate every 30 seconds if not connected');
        console.log('='.repeat(60));
        
        // Also show visual QR (might be broken in server logs)
        qrcode.generate(qr, { small: true });
        
        // Auto-refresh QR code every 20 seconds for server environments
        setTimeout(() => {
          if (!isConnected && sock && sock.ws && sock.ws.readyState === 1) {
            logger.info('🔄 Auto-refreshing QR code for fresh attempt...');
            if (sock && sock.logout) {
              sock.logout().catch(() => {});
            }
          }
        }, 20000);
      }
      
      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error instanceof Boom 
          ? lastDisconnect.error.output?.statusCode 
          : lastDisconnect?.error?.output?.statusCode;
        
        logger.info(`Connection closed. Status: ${statusCode}, Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);
        
        // Handle specific disconnect reasons
        if (statusCode === DisconnectReason.loggedOut) {
          logger.info('📱 Logged out - clearing session and waiting for new QR scan');
          await clearAllWhatsAppSessions();
          isConnecting = false;
          setTimeout(() => initializeWhatsApp(), 5000);
          
        } else if (statusCode === 440) {
          // Multi-device conflict - implement smart resolution
          conflictCount++;
          logger.warn(`⚠️ Multi-device conflict detected (${conflictCount}/${MAX_CONFLICT_ATTEMPTS})`);
          
          if (conflictCount < MAX_CONFLICT_ATTEMPTS) {
            // Wait progressively longer for each conflict
            const waitTime = Math.min(15000 * conflictCount, 60000);
            logger.info(`⏳ Waiting ${waitTime/1000}s before retry...`);
            
            setTimeout(() => {
              isConnecting = false;
              initializeWhatsApp();
            }, waitTime);
          } else {
            // Too many conflicts - clear everything and restart
            logger.error('🚨 Persistent multi-device conflicts. Clearing all sessions and restarting...');
            await clearAllWhatsAppSessions();
            conflictCount = 0;
            reconnectAttempts = 0;
            
            setTimeout(() => {
              isConnecting = false;
              initializeWhatsApp();
            }, 10000);
          }
          
        } else if (statusCode === 408 || /ENOTFOUND/i.test(lastDisconnect?.error?.message || '')) {
          // Network/DNS outage: exponential backoff
          logger.warn(`🌐 Network/DNS error detected. Backing off for ${Math.round(networkBackoffMs/1000)}s before retry`);
          setTimeout(async () => {
            isConnecting = false;
            await waitForWhatsAppDNS();
            initializeWhatsApp();
          }, networkBackoffMs);
          networkBackoffMs = Math.min(networkBackoffMs * 2, MAX_NETWORK_BACKOFF_MS);
          
        } else if (reconnectAttempts < config.whatsapp.maxReconnectAttempts) {
          logger.info(`🔄 Connection closed, attempting to reconnect... (${reconnectAttempts + 1}/${config.whatsapp.maxReconnectAttempts})`);
          reconnectAttempts++;
          setTimeout(() => {
            isConnecting = false;
            initializeWhatsApp();
          }, config.whatsapp.reconnectInterval);
          
        } else {
          logger.error('❌ WhatsApp connection failed permanently');
          process.exit(1);
        }
        
      } else if (connection === 'open') {
        logger.info('✅ WhatsApp connected successfully!');
        reconnectAttempts = 0;
        conflictCount = 0; // Reset conflict counter on successful connection
        isConnecting = false;
        isConnected = true;
        networkBackoffMs = 5000; // reset backoff on success
        
        // Process any queued messages
        if (messageQueue.length > 0) {
          logger.info(`📤 Processing ${messageQueue.length} queued messages`);
          for (const queuedMessage of messageQueue.splice(0)) {
            try {
              await sock.sendMessage(
                queuedMessage.to,
                queuedMessage.content,
                { linkPreview: false, ...(queuedMessage.options || {}) }
              );
              logger.info('✅ Queued message sent successfully');
            } catch (error) {
              logger.error('❌ Failed to send queued message:', error.message);
            }
          }
        }
      }
    });
    
    // Handle incoming messages
    sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      
      if (!msg.key.fromMe && msg.message) {
        try {
          // SOLUTION: Skip messages that arrived before server started
          const messageTimestamp = msg.messageTimestamp;
          if (messageTimestamp && messageTimestamp < SERVER_START_TIME) {
            logger.info(`Skipping old message from ${msg.key.remoteJid} (sent before server restart)`);
            return;
          }
          
          const messageType = Object.keys(msg.message)[0];
          
          // Block group chats explicitly
          const remoteJid = msg.key.remoteJid || '';
          const isGroup = remoteJid.endsWith('@g.us');
          if (isGroup) {
            logger.info('Ignoring message in group chat');
            try {
              await sock.sendMessage(remoteJid, { text: '👋 Hi! Wallet actions are disabled in group chats. Please DM me to continue.' }, { linkPreview: false });
            } catch (e) {
              logger.warn('Failed to send group helper message:', e?.message || e);
            }
            return;
          }

          if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const from = msg.key.remoteJid;
            
            if (text.trim()) {
              logWhatsAppEvent('message_received', { from, text: text.substring(0, 100) });
              
              // Emit message event for command handler via app event bus
              appEvents.emit('message', {
                from,
                text: text.trim(),
                timestamp: msg.messageTimestamp,
                messageId: msg.key.id
              });
            }
          }

          // Handle message reactions (thumbs up/down for transaction confirmation)
          if (messageType === 'reactionMessage') {
            const reaction = msg.message.reactionMessage;
            const from = msg.key.remoteJid;
            
            // SOLUTION: Skip old reactions too
            if (messageTimestamp && messageTimestamp < SERVER_START_TIME) {
              logger.info(`Skipping old reaction from ${from} (sent before server restart)`);
              return;
            }
            
            if (reaction && reaction.text) {
              logWhatsAppEvent('reaction_received', { from, emoji: reaction.text });
              
              // Emit reaction event for command handler
              appEvents.emit('message', {
                from,
                text: reaction.text, // This will be the emoji (👍 or 👎)
                timestamp: msg.messageTimestamp,
                messageId: msg.key.id,
                isReaction: true,
                reactionToMessage: reaction.key?.id
              });
            }
          }

          // Contact share support (WhatsApp contacts vCard)
          if (messageType === 'contactMessage' || messageType === 'contactsArrayMessage') {
            const from = msg.key.remoteJid;
            
            // SOLUTION: Skip old contact shares too
            if (messageTimestamp && messageTimestamp < SERVER_START_TIME) {
              logger.info(`Skipping old contact share from ${from} (sent before server restart)`);
              return;
            }
            
            let contactPhones = [];
            try {
              if (msg.message.contactMessage?.vcard) {
                const phones = parsePhonesFromVcard(msg.message.contactMessage.vcard);
                contactPhones.push(...phones);
              } else if (msg.message.contactsArrayMessage?.contacts) {
                for (const c of msg.message.contactsArrayMessage.contacts) {
                  if (c.vcard) {
                    const phones = parsePhonesFromVcard(c.vcard);
                    contactPhones.push(...phones);
                  }
                  if (c.displayName && c.waid) contactPhones.push(c.waid);
                }
              }
            } catch (e) {
              logger.warn('Failed parsing contact vCard:', e?.message || e);
            }

            // Normalize and dedupe
            contactPhones = Array.from(new Set(contactPhones
              .filter(Boolean)
              .map(n => n.replace(/\D/g, ''))
              .filter(n => n.length >= 6)
            ));
            if (contactPhones.length > 0) {
              appEvents.emit('contact_shared', {
                from,
                phones: contactPhones,
                timestamp: msg.messageTimestamp,
                messageId: msg.key.id
              });
            }
          }
        } catch (error) {
          logger.error('Error processing incoming message:', error);
        }
      }
    });

    // Handle message reactions (separate event in newer Baileys versions)
    sock.ev.on('messages.reaction', async (reactions) => {
      for (const reaction of reactions) {
        if (!reaction.key.fromMe) {
          try {
            const from = reaction.key.remoteJid;
            const emoji = reaction.reaction?.text || '';
            
            // Block group chats
            const isGroup = from.endsWith('@g.us');
            if (isGroup) {
              continue;
            }
            
            if (emoji) {
              logWhatsAppEvent('reaction_received', { from, emoji });
              
              // Emit reaction as a message event
              appEvents.emit('message', {
                from,
                text: emoji,
                timestamp: reaction.reaction?.senderTimestampMs,
                messageId: reaction.key.id,
                isReaction: true,
                reactionToMessage: reaction.reaction?.key?.id
              });
            }
          } catch (error) {
            logger.error('Error handling reaction:', error);
          }
        }
      }
    });
    
    return sock;
    
  } catch (error) {
    isConnecting = false;
    logger.error('❌ Failed to initialize WhatsApp:', error);
    throw error;
  }
};

const sendMessage = async (to, message, options = {}) => {
  try {
    if (!sock) {
      throw new Error('WhatsApp not initialized');
    }
    
    // Normalize content early
    const content = typeof message === 'string' ? { text: message } : message;

    // Check if connection is stable before sending
    if (!isConnected) {
      logger.warn('⚠️ Connection not stable, queueing message');
      messageQueue.push({ to, content, options });
      return;
    }
    
    // Avoid link preview dependency errors by disabling via options
    const result = await sock.sendMessage(to, content, { linkPreview: false, ...(options || {}) });
    
    const preview = typeof message === 'string' ? message : (message?.text || JSON.stringify(message));
    logWhatsAppEvent('message_sent', { to, message: preview.slice(0, 100) });
    return result;
    
  } catch (error) {
    if (error.message.includes('Connection Closed') || error.output?.statusCode === 428) {
      logger.warn('⚠️ Connection closed during send, queueing message');
      const content = typeof message === 'string' ? { text: message } : message;
      messageQueue.push({ to, content, options });
      isConnected = false;
      // Trigger reconnection
      if (!isConnecting) {
        setTimeout(() => {
          isConnecting = false;
          initializeWhatsApp();
        }, 2000);
      }
    } else {
      logger.error('❌ Failed to send message:', error);
      throw error;
    }
  }
};

const sendImage = async (to, imageBuffer, caption = '', options = {}) => {
  try {
    if (!sock) {
      throw new Error('WhatsApp not initialized');
    }
    
    const result = await sock.sendMessage(to, {
      image: imageBuffer,
      caption,
      ...options
    });
    
    logWhatsAppEvent('image_sent', { to, caption });
    return result;
    
  } catch (error) {
    logger.error('❌ Failed to send image:', error);
    throw error;
  }
};

const getConnectionStatus = () => {
  return sock && sock.user ? 'Connected' : 'Disconnected';
};

const getConnectionInfo = () => {
  if (!sock || !sock.user) {
    return { 
      connected: false,
      connection: 'Disconnected',
      reconnectAttempts,
      conflictCount
    };
  }
  
  return {
    connected: true,
    connection: 'Connected',
    phone: sock.user.id,
    name: sock.user.name,
    pushName: sock.user.pushName,
    reconnectAttempts,
    conflictCount
  };
};

// Enhanced vCard phone extraction supporting multiple versions and formats
function parsePhonesFromVcard(vcard) {
  const phones = [];
  try {
    const lines = vcard.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      // TEL lines (vCard 2.1/3.0/4.0)
      // Examples:
      // TEL;type=CELL;waid=1234567890: +1 234 567 890
      // TEL;VALUE=uri:tel:+1234567890
      // item1.TEL:+1 234 567 890
      if (/^(item\d+\.)?TEL/i.test(line)) {
        // waid parameter takes precedence
        const waidMatch = line.match(/waid=([0-9]+)/i);
        if (waidMatch && waidMatch[1]) {
          phones.push(waidMatch[1]);
          continue;
        }

        // URI format
        const uriMatch = line.match(/tel:([+0-9\-()\s]+)/i);
        if (uriMatch && uriMatch[1]) {
          phones.push(uriMatch[1]);
          continue;
        }

        // After colon
        const afterColon = line.split(':')[1];
        if (afterColon) {
          phones.push(afterColon);
          continue;
        }
      }
    }
  } catch (e) {
    // ignore
  }
  return phones;
}

const logout = async () => {
  try {
    if (sock && typeof sock.logout === 'function') {
      logger.info('📱 Logging out from WhatsApp...');
      await sock.logout();
      sock = null;
    }
    
    // Clear all sessions
    await clearAllWhatsAppSessions();
    
    isConnected = false;
    isConnecting = false;
    reconnectAttempts = 0;
    conflictCount = 0;
    
    logger.info('✅ Logged out successfully');
  } catch (error) {
    logger.error('❌ Error during logout:', error.message);
  }
};

// NEW: Manual session reset function to resolve conflicts
const resetSession = async () => {
  try {
    logger.info('🔄 Manually resetting WhatsApp session...');
    
    // Disconnect if connected
    if (sock && typeof sock.logout === 'function') {
      try {
        await sock.logout();
      } catch (e) {
        // Ignore logout errors
      }
      sock = null;
    }
    
    // Clear all sessions
    await clearAllWhatsAppSessions();
    
    // Reset counters
    isConnected = false;
    isConnecting = false;
    reconnectAttempts = 0;
    conflictCount = 0;
    
    // Wait a moment then reinitialize
    setTimeout(() => {
      initializeWhatsApp();
    }, 3000);
    
    logger.info('✅ Session reset complete. Reconnecting...');
  } catch (error) {
    logger.error('❌ Error during session reset:', error.message);
  }
};

// NEW: Force disconnect and clear sessions
const forceDisconnect = async () => {
  try {
    logger.info('🚨 Force disconnecting WhatsApp...');
    
    if (sock && typeof sock.end === 'function') {
      try {
        sock.end();
      } catch (e) {
        // Ignore end errors
      }
      sock = null;
    }
    
    await clearAllWhatsAppSessions();
    
    isConnected = false;
    isConnecting = false;
    reconnectAttempts = 0;
    conflictCount = 0;
    
    logger.info('✅ Force disconnect complete');
  } catch (error) {
    logger.error('❌ Error during force disconnect:', error.message);
  }
};

module.exports = {
  initializeWhatsApp,
  sendMessage,
  sendImage,
  getConnectionStatus,
  getConnectionInfo,
  parsePhonesFromVcard,
  logout,
  resetSession, // NEW: Export the reset function
  forceDisconnect, // NEW: Export the force disconnect function
  getCurrentQR: () => currentQRCode, // NEW: Export current QR code
  getQRAge: () => qrGeneratedAt ? Date.now() - qrGeneratedAt : null, // NEW: QR age
  on: (eventName, handler) => appEvents.on(eventName, handler),
  emit: (eventName, data) => appEvents.emit(eventName, data)
};
