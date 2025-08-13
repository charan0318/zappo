const commandParser = require('../parsers/commandParser');
const walletHandler = require('./walletHandler');
const transactionHandler = require('./transactionHandler');
const contactHandler = require('./contactHandler');
const claimsService = require('../services/claims');
const { logger, logUserAction } = require('../utils/logger');
const { users } = require('../services/database');
const config = require('../config');
const nebulaChat = require('../services/nebulaChat');
const whatsappService = require('../services/whatsapp');
const errorHandler = require('../utils/errorHandler');
const errorRecovery = require('../utils/errorRecovery');

// Inject sendMessage function and shared state into handlers
const injectSendMessage = (sendMessageFunc, pendingTransactions) => {
  walletHandler.sendMessage = sendMessageFunc;
  transactionHandler.sendMessage = sendMessageFunc;
  transactionHandler.pendingTransactions = pendingTransactions; // Share pending transactions
  contactHandler.sendMessage = sendMessageFunc;
};

class CommandHandler {
  constructor(whatsapp) {
    this.whatsapp = whatsapp;
    this.userStates = new Map(); // Track user conversation states
    this.pendingTransactions = new Map(); // Track pending transaction confirmations
    this.seenGroupNotice = new Set();
  }
  
  // Initialize command handler and set up message listeners
  initialize() {
    // Inject sendMessage function and shared state into handlers
    injectSendMessage(this.sendMessage.bind(this), this.pendingTransactions);
    
    this.whatsapp.on('message', async (messageData) => {
      await this.handleMessage(messageData);
    });
    // New: handle shared contacts
    this.whatsapp.on('contact_shared', async (payload) => {
      await this.handleSharedContact(payload);
    });
    
    logger.info('✅ Command handler initialized');
  }
  
  // Main message handling function
  async handleMessage(messageData) {
    try {
      const { from, text, timestamp } = messageData;
      const phone = this.extractPhoneNumber(from);
      
      logUserAction(phone, 'message_received', { 
        text: text.substring(0, 100),
        isReaction: messageData.isReaction || false 
      });

      // Chat-only mode removed; proceed with command parsing
      
      // Check if user has a pending transaction confirmation
      if (this.pendingTransactions.has(phone)) {
        logger.info(`Processing transaction confirmation for ${phone}: "${text}"`);
        await this.handleTransactionConfirmation(from, phone, text);
        return;
      }
      
      // Check if user is in a specific state (wallet creation, import, etc.)
      if (this.userStates.has(phone)) {
        await this.handleStatefulMessage(from, phone, text);
        return;
      }

      // Parse the command/intent
      const parsed = commandParser.parseInput(text);
      
      // Debug logging to see what's happening
      logger.info(`Command parsed: ${text} -> Intent: ${parsed.intent}`);
      
      if (parsed.intent === 'UNKNOWN') {
        // Check if this is a first-time user (no wallet, no state) ONLY for unknown commands
        const existingUser = await users.findUserByPhone(phone);
        if (!existingUser && !text.toLowerCase().includes('help')) {
          await this.sendMessage(from, this.getWelcomeMessage());
          return;
        }
        // For existing users with unknown commands, show help
        await this.sendMessage(from, this.getUnknownCommandResponse());
        return;
      }
      
      if (parsed.intent === 'ERROR') {
        await this.sendMessage(from, 'Sorry, I couldn’t process that request. Please try again.');
        return;
      }
      
      // Admin-only commands (STATUS and RESET)
      if (this.isAdminCommand(text)) {
        await this.handleAdminCommand(from, phone, text);
        return;
      }
      
      // Route to appropriate handler
      await this.routeCommand(from, phone, parsed);
      
    } catch (error) {
      const errorInfo = errorHandler.handleError(error, {
        action: 'handle_message',
        phone: this.extractPhoneNumber(messageData.from),
        message: messageData.text
      });
      
      // Create enhanced error message with recovery options
      const enhancedMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
      
      await this.sendMessage(messageData.from, enhancedMessage);
      
      // If it's a high severity error, log additional details
      if (errorInfo.severity === 'high') {
        logger.error('High severity error in message handling:', {
          phone: this.extractPhoneNumber(messageData.from),
          error: error.message,
          stack: error.stack
        });
      }
    }
  }

  // Handle shared contact payload
  async handleSharedContact(payload) {
    const { from, phones } = payload;
    const senderPhone = this.extractPhoneNumber(from);
    try {
      const { users } = require('../services/database');
      // Prefer the first resolvable phone
      for (const p of phones) {
        const normalized = p.replace(/^\+/, '');
        const contactUser = await users.findUserByPhone(normalized);
        if (contactUser) {
          await this.sendMessage(from, `✅ Contact is registered on ZAPPO.\n\n🏦 Address: \`${contactUser.wallet_address}\`\n\nHow much AVAX do you want to send?`);
          // Prime a state to expect amount then confirmation
          this.userStates.set(senderPhone, {
            state: 'AWAITING_AMOUNT_FOR_CONTACT',
            targetAddress: contactUser.wallet_address,
            contactPhone: normalized,
            timestamp: Date.now()
          });
          return;
        } else {
          // Not registered → offer claim-link escrow flow
          await this.sendMessage(from, `👤 This contact isn't registered on ZAPPO yet.\n\nThey'll have up to 3 days to claim a transfer you initiate; if they don't, it's automatically refunded to you.\n\n💡 *Note:* Gas fees for processing the claim will be deducted from the amount you send.\n\nHow much AVAX would you like to send?`);
          this.userStates.set(senderPhone, {
            state: 'AWAITING_AMOUNT_FOR_UNREGISTERED',
            recipientPhone: normalized,
            timestamp: Date.now()
          });
          return;
        }
      }
      await this.sendMessage(from, 'ℹ️ Couldn’t read a phone number from that contact. Please share again or paste a 0x address.');
    } catch (e) {
      logger.error('Error handling shared contact:', e);
      await this.sendMessage(from, '❌ Could not process the shared contact. Please try again.');
    }
  }
  
  // Route commands to appropriate handlers
  async routeCommand(from, phone, parsed) {
    const { intent, parameters } = parsed;
    
    try {
      switch (intent) {
        case 'HELP':
          await this.sendMessage(from, commandParser.getHelpText());
          break;
          
        case 'CREATE_WALLET':
          await this.handleCreateWallet(from, phone);
          break;
          
        case 'IMPORT_WALLET':
          await this.handleImportWallet(from, phone);
          break;
          
        case 'BACKUP_WALLET':
          await walletHandler.handleBackup(from, phone);
          break;
          
        case 'GET_BALANCE':
          await transactionHandler.handleGetBalance(from, phone);
          break;
          
        case 'GET_HISTORY':
          await transactionHandler.handleGetHistory(from, phone);
          break;
          
        case 'SEND_AVAX':
        case 'SEND_COMMAND':
        case 'NATURAL_SEND':
          await this.handleSendTransaction(from, phone, parameters);
          break;
          
        case 'SEND_AVAX_START':
          await this.handleSendTransaction(from, phone, { intent: 'SEND_AVAX_START' });
          break;
          
        case 'ADD_CONTACT':
          await contactHandler.handleAddContact(from, phone, parameters);
          break;
          
        case 'LIST_CONTACTS':
          await contactHandler.handleListContacts(from, phone);
          break;

        case 'CLAIM':
          await this.handleClaimFlow(from, phone, parameters.token);
          break;
          
        default:
          await this.sendMessage(from, this.getUnknownCommandResponse());
      }
      
      logUserAction(phone, 'command_executed', { intent, success: true });
      
    } catch (error) {
      logger.error(`Error executing command ${intent}:`, error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
      logUserAction(phone, 'command_executed', { intent, success: false, error: error.message });
    }
  }

  // Handle claim flow when user sends CLAIM <TOKEN>
  async handleClaimFlow(from, phone, tokenPlain) {
    try {
      logger.info(`Claim attempt: ${phone} with token: ${tokenPlain?.substring(0, 8)}...`);
      
      // Ensure user has wallet; if not, prompt and exit
      const hasWallet = await walletHandler.validateUserWallet(phone);
      if (!hasWallet) {
        logger.info(`User ${phone} has no wallet, prompting wallet creation`);
        await this.sendMessage(from, `🌟 *Welcome! You have AVAX waiting to claim!* 🌟\n\nTo receive your AVAX, you need a wallet. Would you like me to:\n\n🆕 *Create a new wallet* (recommended for beginners)\n📥 *Import an existing wallet*\n\nReply with "create wallet" or "import wallet" to continue.`);
        return;
      }
      
      const wallet = await walletHandler.getUserWallet(phone);
      logger.info(`User ${phone} has wallet: ${wallet.address}`);
      
      const result = await claimsService.validateAndClaim({ 
        tokenPlain, 
        claimerPhone: phone, 
        recipientWalletAddress: wallet.address 
      });
      
      logger.info(`Claim successful for ${phone}: ${result.transferAmount} AVAX`);
      
      await this.sendMessage(from, `✅ *Claimed Successfully!*

💰 *Amount Received:* ${result.transferAmount.toFixed(6)} AVAX
⛽ *Gas Fee:* ${result.gasCost.toFixed(6)} AVAX
🔗 *Transaction Hash:* \`${result.tx.hash}\`
📊 *View on Snowtrace:* https://snowtrace.io/tx/${result.tx.hash}

*Note: Gas fees were deducted from the held amount to complete your claim.*`);
      
    } catch (error) {
      logger.error(`Claim failed for ${phone}:`, error);
      
      // Provide better error messages based on error type
      if (error.message.includes('Amount too small')) {
        await this.sendMessage(from, `❌ *Claim Failed - Amount Too Small*

${error.message}

💡 *Solutions:*
• Ask sender to send more AVAX
• Wait for lower network congestion
• Contact sender for assistance

⛽ *Gas fees vary with network activity*`);
      } else if (error.message.includes('gas fees')) {
        await this.sendMessage(from, `❌ *Claim Failed - Gas Fee Issue*

${error.message}

💡 *What happened:*
• Network gas fees are higher than expected
• Available amount is too small to cover fees

🔄 *Try again:*
• Ask sender to send at least 0.005 AVAX
• Or try again during off-peak hours`);
      } else {
        await this.sendMessage(from, `❌ *Unable to claim:* ${error.message}\n\n🔍 *Possible reasons:*\n• Link expired or already used\n• Wrong phone number\n• Insufficient funds for gas fees\n• Technical issue\n\n💡 *Need help?* Contact support or ask the sender to resend the claim link.`);
      }
    }
  }
  
  // Handle wallet creation flow
  async handleCreateWallet(from, phone) {
    try {
      // Check if user already has a wallet
      const existingUser = await users.findUserByPhone(phone);
      if (existingUser) {
        await this.sendMessage(from, '❌ You already have a wallet! Use `/backup` to export your private key.');
        return;
      }
      
      await this.sendMessage(from, '🔄 Creating your wallet... This may take a moment.');
      
      const result = await walletHandler.createWallet(phone);
      
      if (result.success) {
        await this.sendMessage(from, `✅ *Wallet Created Successfully!*

🏦 Your wallet is now ready to use! Try:
• \`/balance\` - Check your balance
• \`/backup\` - Export your private key
• \`/help\` - See all commands

💡 *To start sending AVAX, deposit some AVAX to your wallet first!*`);
        
        // Send wallet address as separate message for easy copying
        await this.sendMessage(from, `📋 *Your Wallet Address:*\n\`${result.walletAddress}\`\n\n*Tap to copy this address for deposits!*`);
      } else {
        await this.sendMessage(from, `❌ Failed to create wallet: ${result.error}`);
      }
      
    } catch (error) {
      logger.error('Error creating wallet:', error);
      await this.sendMessage(from, `❌ Error creating wallet: ${error.message}`);
    }
  }
  
  // Handle wallet import flow
  async handleImportWallet(from, phone) {
    try {
      // Check if user already has a wallet
      const existingUser = await users.findUserByPhone(phone);
      if (existingUser) {
        await this.sendMessage(from, 'You already have a wallet set up. You can export your private key anytime with /backup.');
        return;
      }
      
      // Set user state to expect private key
      this.userStates.set(phone, {
        state: 'IMPORTING_WALLET',
        timestamp: Date.now()
      });
      
      await this.sendMessage(from, `Let’s import your wallet.

Please paste your private key here to proceed.

Security tips:
- Share your private key only in this chat.
- Never share it with anyone else.
- We’ll encrypt it securely.

You can type cancel to stop anytime.`);
      
    } catch (error) {
      logger.error('Error starting wallet import:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Handle send transaction flow
  async handleSendTransaction(from, phone, parameters) {
    try {
      // Check if user has a wallet
      const user = await users.findUserByPhone(phone);
      if (!user) {
        await this.sendMessage(from, '❌ You need to create a wallet first! Send "create wallet" to get started.');
        return;
      }
      
      let sendParams;
      
      if (parameters.amount && parameters.recipient) {
        // Direct parameters from regex match
        sendParams = {
          amount: parameters.amount,
          recipient: parameters.recipient,
          valid: true
        };
      } else if (parameters.args) {
        // Parse from command arguments
        sendParams = commandParser.parseSendParameters(parameters.args);
      } else if (parameters.intent === 'SEND_AVAX_START') {
        // Multi-step flow: user just typed "send avax"
        this.userStates.set(phone, {
          state: 'AWAITING_CONTACT_FOR_SEND',
          timestamp: Date.now()
        });
        await this.sendMessage(from, `📱 *Send AVAX - Step 1: Contact*\n\nPlease share the contact you want to send AVAX to.\n\nYou can:\n• Share a contact from your phone\n• Or type the phone number (e.g., 919489042245)\n\nType "cancel" to stop.`);
        return;
      } else {
        await this.sendMessage(from, '❌ Invalid send format. Try: "send 1 AVAX to 0x..." or just type "send avax" for step-by-step.');
        return;
      }
      
      if (!sendParams.valid) {
        await this.sendMessage(from, `❌ ${sendParams.error}`);
        return;
      }
      
      // Validate amount
      if (!commandParser.validateAmount(sendParams.amount)) {
        await this.sendMessage(from, '❌ Invalid amount. Please enter a valid amount between 0.000001 and 1,000,000 AVAX.');
        return;
      }
      
      // Process the transaction
      await transactionHandler.handleSendTransaction(from, phone, sendParams);
      
    } catch (error) {
      logger.error('Error handling send transaction:', error);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Handle transaction confirmation responses
  async handleTransactionConfirmation(from, phone, text) {
    try {
      const pendingTx = this.pendingTransactions.get(phone);
      
      // Handle regular transaction confirmations
      if (commandParser.isConfirmation(text)) {
        // User confirmed the transaction
        logger.info(`Transaction confirmed by ${phone} with: ${text}`);
        this.pendingTransactions.delete(phone);
        await transactionHandler.executePendingTransaction(from, phone, pendingTx);
        
      } else if (commandParser.isCancellation(text)) {
        // User cancelled the transaction
        logger.info(`Transaction cancelled by ${phone} with: ${text}`);
        this.pendingTransactions.delete(phone);
        await this.sendMessage(from, '❌ Transaction cancelled.');
        
      } else {
        // Invalid response
        logger.info(`Invalid confirmation response from ${phone}: ${text}`);
        await this.sendMessage(from, '❓ Please react with 👍 to confirm or 👎 to cancel the transaction.');
      }
      
    } catch (error) {
      logger.error('Error handling transaction confirmation:', error);
      this.pendingTransactions.delete(phone);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Handle stateful messages (wallet import, etc.)
  async handleStatefulMessage(from, phone, text) {
    try {
      const msg = (text ?? '').toString().trim();
      const userState = this.userStates.get(phone);
      
      if (msg.toLowerCase() === 'cancel') {
        this.userStates.delete(phone);
        await this.sendMessage(from, '❌ Operation cancelled.');
        return;
      }
      
      // If there is no active state, guide the user instead of crashing
      if (!userState) {
        await this.sendMessage(from, 'There’s no active action to continue. Please start again (e.g., share a contact or type a command).');
        return;
      }

      // Check if state has expired (5 minutes)
      if (Date.now() - userState.timestamp > 5 * 60 * 1000) {
        this.userStates.delete(phone);
        await this.sendMessage(from, '⏰ Operation timed out. Please try again.');
        return;
      }
      
      switch (userState.state) {
        case 'IMPORTING_WALLET':
          await this.handlePrivateKeyInput(from, phone, text);
          break;
        case 'AWAITING_AMOUNT_FOR_CONTACT': {
          const amount = parseFloat(msg);
          if (!isNaN(amount) && amount > 0) {
            const target = userState.targetAddress;
            this.userStates.delete(phone);
            await this.handleSendTransaction(from, phone, { amount, recipient: target });
          } else {
            await this.sendMessage(from, '❌ Please enter a valid AVAX amount (e.g., 0.1).');
          }
          break;
        }
        case 'AWAITING_AMOUNT_FOR_UNREGISTERED': {
          const amount = parseFloat(msg);
          if (!isNaN(amount) && amount > 0) {
            const recipientPhone = userState.recipientPhone;
            this.userStates.delete(phone);
            // Route through send flow; it will detect phone-like recipient and use claim-link escrow
            await this.handleSendTransaction(from, phone, { amount, recipient: recipientPhone });
          } else {
            await this.sendMessage(from, '❌ Please enter a valid AVAX amount (e.g., 0.1).');
          }
          break;
        }
        case 'AWAITING_CONTACT_FOR_SEND': {
          // User provided contact, now ask for amount
          this.userStates.set(phone, {
            state: 'AWAITING_AMOUNT_FOR_SEND',
            recipientPhone: msg,
            timestamp: Date.now()
          });
          await this.sendMessage(from, `📱 *Send AVAX - Step 2: Amount*\n\nHow much AVAX would you like to send to ${msg}?\n\nPlease enter the amount (e.g., 0.1, 1.5, 10)\n\nType "cancel" to stop.`);
          break;
        }
        case 'AWAITING_AMOUNT_FOR_SEND': {
          const amount = parseFloat(msg);
          if (!isNaN(amount) && amount > 0) {
            const recipientPhone = userState.recipientPhone;
            this.userStates.delete(phone);
            // Route through send flow; it will detect phone-like recipient and use claim-link escrow
            await this.handleSendTransaction(from, phone, { amount, recipient: recipientPhone });
          } else {
            await this.sendMessage(from, '❌ Please enter a valid AVAX amount (e.g., 0.1).');
          }
          break;
        }
          
        default:
          this.userStates.delete(phone);
          await this.sendMessage(from, '❌ Invalid state. Please try again.');
      }
      
    } catch (error) {
      logger.error('Error handling stateful message:', error);
      this.userStates.delete(phone);
      await this.sendMessage(from, `❌ Error: ${error.message}`);
    }
  }
  
  // Handle private key input for wallet import
  async handlePrivateKeyInput(from, phone, privateKey) {
    try {
      // Validate private key format
      if (!privateKey.match(/^0x[a-fA-F0-9]{64}$/)) {
        await this.sendMessage(from, 'That doesn’t look like a valid private key. Please send a 64‑character hex key starting with 0x.');
        return;
      }
      
      await this.sendMessage(from, 'Importing your wallet… this usually takes a moment.');
      
      const result = await walletHandler.importWallet(phone, privateKey);
      
      if (result.success) {
        this.userStates.delete(phone);
        await this.sendMessage(from, `Wallet imported successfully.

Address: \`${result.walletAddress}\`
Balance: ${result.balance} AVAX

You’re all set. You can try:
- /balance to check your balance
- /history to view recent transactions
- /help to see all commands`);
      } else {
        await this.sendMessage(from, `Couldn’t import the wallet: ${result.error}`);
      }
      
    } catch (error) {
      logger.error('Error importing wallet:', error);
      this.userStates.delete(phone);
      await this.sendMessage(from, `We couldn’t complete the import: ${error.message}`);
    }
  }
  
  // Store pending transaction for confirmation
  storePendingTransaction(phone, transactionData) {
    this.pendingTransactions.set(phone, {
      ...transactionData,
      timestamp: Date.now()
    });
  }
  
  // Extract phone number from WhatsApp ID
  extractPhoneNumber(whatsappId) {
    // Remove @s.whatsapp.net suffix and country code if present
    return whatsappId.replace('@s.whatsapp.net', '').replace('@c.us', '');
  }
  
  // Send message helper
  async sendMessage(to, message) {
    try {
      // FIXED: Baileys expects message content as object, not string
      const messageContent = typeof message === 'string' 
        ? { text: message } 
        : message;

      // Normalize JID to ensure valid WhatsApp ID
      let jid = to || '';
      if (typeof jid === 'string') {
        if (!jid.includes('@')) {
          jid = `${jid.replace(/\D/g, '')}@s.whatsapp.net`;
        } else if (jid.endsWith('@c.us')) {
          jid = jid.replace('@c.us', '@s.whatsapp.net');
        }
      }

      // Route through our WhatsApp service to leverage queueing & connection checks
      await whatsappService.sendMessage(jid, messageContent);
    } catch (error) {
      logger.error('Error sending message:', error);
    }
  }
  
  // Get beautiful welcome message for first-time users
  getWelcomeMessage() {
    return `🌟 *Welcome to ZAPPO!* 🌟

🎉 *Your Personal AVAX Wallet on WhatsApp*

I'm here to help you manage your Avalanche (AVAX) cryptocurrency right from your phone! 

💼 *What would you like to do?*

🆕 *Create a New Wallet*
• Type: "create wallet" or "new wallet"
• I'll generate a secure wallet for you
• Perfect for beginners

📥 *Import Existing Wallet*
• Type: "import wallet" 
• Use your private key to restore access
• Great if you already have a wallet

💸 *Send AVAX to Contacts*
• Type: "send avax" to start sending to your contacts
• Easy transfers via WhatsApp contacts!

❓ *Need Help?*
• Type: \`/help\` for all commands
• Ask me anything about crypto!

🚀 *Ready to get started?* Just let me know what you'd prefer!`;
  }

  // Get response for unknown commands
  getUnknownCommandResponse() {
    return `🤖 *ZAPPO - AVAX Wallet Bot*

I didn't understand that command. Here are some things you can try:

• \`/help\` - Show all commands
• "create wallet" - Create a new wallet
• "import wallet" - Import existing wallet
• \`/balance\` - Check your balance
• "send avax" - Start sending AVAX to contacts
• "send 1 AVAX to 0x..." - Send AVAX to address

Need help? Type \`/help\` for a full list of commands!`;
  }

  // Check if command is admin-only
  isAdminCommand(text) {
    const command = text.toLowerCase().trim();
    return command === '/status' || command === '/reset' || command.startsWith('/admin');
  }

  // Handle admin commands with authorization
  async handleAdminCommand(from, phone, text) {
    // Define admin phone numbers (replace with actual admin numbers)
    const adminNumbers = [
      '919489042245', // Replace with actual admin phone numbers
      // Add more admin numbers as needed
    ];
    
    if (!adminNumbers.includes(phone)) {
      await this.sendMessage(from, '❌ Access denied. This command is restricted to administrators only.');
      logger.warn(`Unauthorized admin command attempt from ${phone}: ${text}`);
      return;
    }
    
    const command = text.toLowerCase().trim();
    
    try {
      switch (command) {
        case '/status':
          await this.handleStatusCommand(from, phone);
          break;
        case '/reset':
          await this.handleResetCommand(from, phone);
          break;
        default:
          await this.sendMessage(from, '❌ Unknown admin command. Available: /status, /reset');
      }
      
      logger.info(`Admin command executed by ${phone}: ${command}`);
      
    } catch (error) {
      logger.error(`Error executing admin command ${command}:`, error);
      await this.sendMessage(from, `❌ Error executing admin command: ${error.message}`);
    }
  }

  // Handle status command for admins
  async handleStatusCommand(from, phone) {
    try {
      const stats = {
        userStates: this.userStates.size,
        pendingTransactions: this.pendingTransactions.size,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      };
      
      const response = `🔧 *ZAPPO Admin Status*

👥 *Active User States:* ${stats.userStates}
⏳ *Pending Transactions:* ${stats.pendingTransactions}
⏱️ *Uptime:* ${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m
💾 *Memory Usage:* ${Math.round(stats.memory.heapUsed / 1024 / 1024)}MB / ${Math.round(stats.memory.heapTotal / 1024 / 1024)}MB

🕐 *Timestamp:* ${new Date().toISOString()}`;

      await this.sendMessage(from, response);
      
    } catch (error) {
      logger.error('Error in status command:', error);
      await this.sendMessage(from, `❌ Error retrieving status: ${error.message}`);
    }
  }

  // Handle reset command for admins
  async handleResetCommand(from, phone) {
    try {
      const beforeStates = this.userStates.size;
      const beforeTransactions = this.pendingTransactions.size;
      
      this.userStates.clear();
      this.pendingTransactions.clear();
      
      const response = `🔄 *ZAPPO Admin Reset Complete*

✅ *Cleared:*
• User States: ${beforeStates} → 0
• Pending Transactions: ${beforeTransactions} → 0

🕐 *Reset at:* ${new Date().toISOString()}`;

      await this.sendMessage(from, response);
      logger.info(`Admin reset executed by ${phone}`);
      
    } catch (error) {
      logger.error('Error in reset command:', error);
      await this.sendMessage(from, `❌ Error executing reset: ${error.message}`);
    }
  }
}

module.exports = {
  initializeCommandHandler: (whatsapp) => {
    const handler = new CommandHandler(whatsapp);
    handler.initialize();
    return handler;
  }
};
