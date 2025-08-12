# 🤖 ZAPPO - WhatsApp AVAX Wallet Bot

> **Send, receive, and manage AVAX directly in WhatsApp** - No browser, no extensions, no complexity!

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Bot-green.svg)](https://whatsapp.com/)

## 🎯 What is ZAPPO?

ZAPPO is a **WhatsApp-native crypto wallet** that allows users to create wallets, view balances, send/receive AVAX, and track transactions — entirely inside WhatsApp chat, without any browser, extension, or seed phrase complexity.

### 🌟 Key Features

- **📱 WhatsApp Native** - Works entirely within WhatsApp
- **🔐 Secure Wallet Creation** - Powered by Privy for phone-linked wallets
- **💸 Send/Receive AVAX** - Direct transactions on AVAX C-Chain
- **📊 Real-time Balance** - Check your AVAX balance instantly
- **📋 Transaction History** - View recent transactions with explorer links
- **👥 Contact Management** - Save addresses as contacts for easy sending
- **🔔 Instant Notifications** - Get notified of incoming transactions
- **🛡️ Encrypted Storage** - Private keys stored securely
- **🌐 Natural Language** - Use commands or natural language

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- MongoDB (local or cloud)
- WhatsApp account for the bot
- Privy account (for wallet infrastructure)
- Thirdweb account (for blockchain operations)

### 1. Clone & Install

```bash
git clone <repository-url>
cd zappo
npm install
```

### 2. Setup Configuration

```bash
npm run setup
```

This interactive setup will help you configure:
- MongoDB connection
- Privy credentials
- Thirdweb credentials
- Security keys

### 3. Start the Bot

```bash
npm start
```

### 4. Connect WhatsApp

1. Scan the QR code with your WhatsApp
2. The bot will connect and be ready to use
3. Send `/help` to see all available commands

## 📱 Usage Guide

### Basic Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/help` | Show all commands | `/help` |
| `create wallet` | Create new wallet | `create wallet` |
| `import wallet` | Import existing wallet | `import wallet` |
| `/balance` | Check AVAX balance | `/balance` |
| `/history` | View transactions | `/history` |
| `/backup` | Export private key | `/backup` |

### Sending AVAX

**Command Format:**
```
/send amount AVAX to recipient
```

**Examples:**
```
/send 1 AVAX to 0x1234...
send 0.5 AVAX to John
transfer 2 to 0xabcd...
```

### Contact Management

**Add Contact:**
```
/addcontact John 0x1234...
```

**Send to Contact:**
```
send 1 AVAX to John
```

### Natural Language

ZAPPO understands natural language:
- "What's my balance?"
- "Show me my transaction history"
- "Send 1 AVAX to 0x..."
- "Transfer 0.5 to John"

## 🏗️ Architecture

### Tech Stack

- **WhatsApp Integration**: [Baileys.js](https://github.com/WhiskeySockets/Baileys)
- **Wallet Infrastructure**: [Privy](https://privy.io/)
- **Blockchain Operations**: [Thirdweb/Nebula](https://portal.thirdweb.com/)
- **Database**: MongoDB
- **Backend**: Node.js
- **Chain**: AVAX C-Chain Mainnet

### Project Structure

```
zappo/
├── src/
│   ├── config/          # Configuration management
│   ├── services/        # Core services (WhatsApp, Privy, Nebula)
│   ├── handlers/        # Command handlers
│   ├── parsers/         # Command parsing and NLP
│   └── utils/           # Utilities and logging
├── logs/                # Application logs
├── auth/                # WhatsApp session data
├── package.json
├── README.md
└── env.example
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file with:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/zappo

# Privy (Wallet Infrastructure)
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret

# Thirdweb (Blockchain Operations)
THIRDWEB_CLIENT_ID=your_thirdweb_client_id
THIRDWEB_CLIENT_SECRET=your_thirdweb_client_secret

# Security
ENCRYPTION_KEY=your_32_char_encryption_key
JWT_SECRET=your_jwt_secret

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

### Getting API Keys

1. **Privy**: Sign up at [console.privy.io](https://console.privy.io/)
2. **Thirdweb**: Sign up at [portal.thirdweb.com](https://portal.thirdweb.com/)
3. **MongoDB**: Use local MongoDB or [MongoDB Atlas](https://mongodb.com/atlas)

## 🔐 Security Features

- **Encrypted Storage**: Private keys encrypted with AES-256
- **Phone Verification**: Wallets linked to phone numbers
- **Session Management**: Secure WhatsApp session handling
- **Input Validation**: Comprehensive validation for all inputs
- **Error Handling**: Graceful error handling and logging

## 📊 Database Schema

### Users Collection
```json
{
  "phone": "+1234567890",
  "wallet_address": "0x...",
  "privy_user_id": "privy_123",
  "private_key": "encrypted_key",
  "created_at": "timestamp"
}
```

### Transactions Collection
```json
{
  "user_phone": "+1234567890",
  "tx_hash": "0x...",
  "from": "0x...",
  "to": "0x...",
  "amount": 1.5,
  "status": "success",
  "timestamp": "timestamp"
}
```

### Contacts Collection
```json
{
  "owner_phone": "+1234567890",
  "name": "John",
  "address": "0x...",
  "created_at": "timestamp"
}
```

## 🚀 Deployment

### Local Development

```bash
npm run dev  # Development with nodemon
npm start    # Production start
```

### Production Deployment

1. **Environment Setup**
   ```bash
   NODE_ENV=production
   LOG_LEVEL=warn
   ```

2. **Process Management**
   ```bash
   npm install -g pm2
   pm2 start src/index.js --name zappo
   ```

3. **MongoDB Setup**
   - Use MongoDB Atlas for production
   - Set up proper authentication
   - Configure network access

## 🧪 Testing

```bash
npm test        # Run tests
npm run lint    # Lint code
```

## 📝 API Reference

### Command Parser

The bot uses regex-based intent parsing with natural language support:

```javascript
// Parse user input
const parsed = commandParser.parseInput("send 1 AVAX to 0x1234...");
// Returns: { intent: 'SEND_AVAX', parameters: { amount: 1, recipient: '0x1234...' } }
```

### Wallet Operations

```javascript
// Create wallet
const result = await walletHandler.createWallet(phone);

// Get balance
const balance = await transactionHandler.handleGetBalance(from, phone);

// Send transaction
const tx = await transactionHandler.handleSendTransaction(from, phone, params);
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/zappo/issues)
- **Documentation**: [Wiki](https://github.com/your-repo/zappo/wiki)

## 🙏 Acknowledgments

- [Baileys.js](https://github.com/WhiskeySockets/Baileys) for WhatsApp integration
- [Privy](https://privy.io/) for wallet infrastructure
- [Thirdweb](https://thirdweb.com/) for blockchain operations
- [Avalanche](https://avax.network/) for the blockchain

---

**Made with ❤️ for the AVAX community**

*ZAPPO - Bringing crypto to where people already are*
