const { logger } = require('../utils/logger');

class CommandParser {
  constructor() {
    this.intents = {
      // Wallet commands
      CREATE_WALLET: /^(create|new|setup)\s+(wallet|account)/i,
      IMPORT_WALLET: /^(import|restore)\s+(wallet|account)/i,
      BACKUP_WALLET: /^\/backup$/i,
      
      // Balance and info
      GET_BALANCE: /^(balance|bal|check\s+balance|show\s+balance|what.*balance)/i,
      GET_HISTORY: /^(history|transactions|txn|recent|last\s+transactions)/i,
      
      // Send commands
      SEND_AVAX: /^(send|transfer|pay)\s+(\d+(?:\.\d+)?)\s*(avax|avalanche)?\s*(to|@)?\s*(.+)/i,
      SEND_AVAX_START: /^(send|transfer|pay)\s+(avax|avalanche)$/i,
      SEND_COMMAND: /^\/send\s+(.+)/i,
      
      // Contact management
      ADD_CONTACT: /^\/addcontact\s+(\w+)\s+(0x[a-fA-F0-9]{40})/i,
      LIST_CONTACTS: /^(contacts|list\s+contacts)/i,
      
      // Help
      HELP: /^(help|commands|what\s+can\s+you\s+do)/i,
      
      // Session management
      // Remove STATUS from user commands - admin only
      // STATUS: /^(status|connection|connected|whatsapp\s+status)/i,
      
      // Natural language variations
      NATURAL_SEND: /^(can\s+you\s+)?(send|transfer|pay)\s+(.+)/i,
      NATURAL_BALANCE: /^(what.*|show.*|check.*|get.*)\s+(balance|money|funds)/i,
      NATURAL_HISTORY: /^(what.*|show.*|check.*|get.*)\s+(history|transactions|activity)/i
    };
    
    this.commands = {
      '/help': 'HELP',
      '/balance': 'GET_BALANCE',
      '/history': 'GET_HISTORY',
      '/backup': 'BACKUP_WALLET',
      '/send': 'SEND_COMMAND',
      '/addcontact': 'ADD_CONTACT',
      // Remove /status from user commands - admin only  
      // '/status': 'STATUS'
    };
  }
  
  // Parse user input and extract intent and parameters
  parseInput(input) {
    try {
      const cleanInput = input.trim();
      
      // Check for exact command matches first
      if (this.commands[cleanInput.toLowerCase()]) {
        return {
          intent: this.commands[cleanInput.toLowerCase()],
          confidence: 1.0,
          parameters: {},
          originalInput: cleanInput
        };
      }
      
      // Check for command with parameters
      for (const [command, intent] of Object.entries(this.commands)) {
        if (cleanInput.toLowerCase().startsWith(command.toLowerCase() + ' ')) {
          const params = cleanInput.substring(command.length + 1).trim();
          return {
            intent: intent,
            confidence: 1.0,
            parameters: { args: params },
            originalInput: cleanInput
          };
        }
      }
      
      // Check regex patterns for natural language
      for (const [intent, pattern] of Object.entries(this.intents)) {
        const match = cleanInput.match(pattern);
        if (match) {
          return this.extractParameters(intent, match, cleanInput);
        }
      }
      
      // CLAIM link handling: detect "CLAIM <TOKEN>"
      const claimMatch = cleanInput.match(/^CLAIM\s+([A-Za-z0-9_-]{10,})$/i);
      if (claimMatch) {
        return {
          intent: 'CLAIM',
          confidence: 1.0,
          parameters: { token: claimMatch[1] },
          originalInput: cleanInput
        };
      }

      // No intent found
      return {
        intent: 'UNKNOWN',
        confidence: 0.0,
        parameters: {},
        originalInput: cleanInput
      };
      
    } catch (error) {
      logger.error('Error parsing input:', error);
      return {
        intent: 'ERROR',
        confidence: 0.0,
        parameters: {},
        originalInput: input,
        error: error.message
      };
    }
  }
  
  // Extract parameters based on intent and regex match
  extractParameters(intent, match, originalInput) {
    const parameters = {};
    
    switch (intent) {
      case 'SEND_AVAX':
        parameters.amount = parseFloat(match[2]);
        parameters.recipient = match[5].trim();
        break;
        
      case 'SEND_COMMAND':
        parameters.args = match[1].trim();
        break;
        
      case 'ADD_CONTACT':
        parameters.name = match[1];
        parameters.address = match[2];
        break;
        
      case 'NATURAL_SEND':
        parameters.args = match[3].trim();
        break;
        
      case 'NATURAL_BALANCE':
      case 'NATURAL_HISTORY':
        // No specific parameters needed
        break;
    }
    
    return {
      intent: intent,
      confidence: 0.9, // High confidence for regex matches
      parameters: parameters,
      originalInput: originalInput
    };
  }
  
  // Parse send command parameters
  parseSendParameters(args) {
    try {
      // Pattern: "amount AVAX to recipient"
      const sendPattern = /^(\d+(?:\.\d+)?)\s*(avax|avalanche)?\s*(to|@)?\s*(.+)/i;
      const match = args.match(sendPattern);
      
      if (match) {
        return {
          amount: parseFloat(match[1]),
          recipient: match[4].trim(),
          valid: true
        };
      }
      
      // Try to extract amount and recipient from natural language
      const amountPattern = /(\d+(?:\.\d+)?)/;
      const amountMatch = args.match(amountPattern);
      
      if (amountMatch) {
        const amount = parseFloat(amountMatch[1]);
        const recipient = args.replace(amountMatch[0], '').replace(/\s*(avax|avalanche|to|@)\s*/gi, '').trim();
        
        if (recipient) {
          return {
            amount: amount,
            recipient: recipient,
            valid: true
          };
        }
      }
      
      return { valid: false, error: 'Invalid send format. Use: amount AVAX to recipient' };
      
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
  
  // Validate address format
  validateAddress(address) {
    const addressPattern = /^0x[a-fA-F0-9]{40}$/;
    return addressPattern.test(address);
  }
  
  // Validate amount
  validateAmount(amount) {
    return !isNaN(amount) && amount > 0 && amount <= 1000000; // Max 1M AVAX
  }
  
  // Get help text for commands
  getHelpText() {
    return `🤖 *ZAPPO Commands*

*Wallet Management:*
• \`/help\` - Show this help message
• Create wallet - "create wallet" or "new wallet"
• Import wallet - "import wallet" with private key
• \`/backup\` - Export your private key

*Balance & History:*
• \`/balance\` - Check AVAX balance
• \`/history\` - View recent transactions

*Send AVAX:*
• \`/send amount AVAX to address\`
• "send 1 AVAX to 0x..." or "transfer 0.5 to John"
• "send avax" - Step-by-step send flow

*Contacts:*
• \`/addcontact name 0xaddress\` - Save contact
• "contacts" - List saved contacts

*Examples:*
• "send 1 AVAX to 0x1234..."
• "what's my balance?"
• "show transaction history"
• "transfer 0.5 to John"

*Transaction Confirmation:*
• React with 👍 to confirm transactions
• React with 👎 to cancel transactions`;
  }
  
  // Check if input is a confirmation
  isConfirmation(input) {
    const confirmPatterns = [
      /^(yes|y|confirm|ok|sure|proceed)$/i,
      /^(send|go|execute|submit)$/i,
      /👍/,  // Thumbs up emoji
      /^👍$/  // Only thumbs up emoji
    ];
    
    const trimmedInput = input.trim();
    return confirmPatterns.some(pattern => pattern.test(trimmedInput));
  }
  
  // Check if input is a cancellation
  isCancellation(input) {
    const cancelPatterns = [
      /^(no|n|cancel|stop|abort|nevermind)$/i,
      /^(don't|dont|do not) send$/i,
      /👎/,  // Thumbs down emoji
      /^👎$/  // Only thumbs down emoji
    ];
    
    return cancelPatterns.some(pattern => pattern.test(input.trim()));
  }
}

module.exports = new CommandParser();
