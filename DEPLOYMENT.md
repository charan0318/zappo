# 🚀 ZAPPO Deployment Guide

This guide will help you deploy ZAPPO to production environments.

## 📋 Prerequisites

- Node.js 18+ installed on server
- MongoDB instance (local or cloud)
- Domain name (optional, for SSL)
- Server with at least 1GB RAM
- Stable internet connection

## 🏗️ Server Setup

### 1. Update System

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Install Node.js

```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### 3. Install MongoDB

#### Option A: Local MongoDB
```bash
# Install MongoDB
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

#### Option B: MongoDB Atlas (Recommended)
1. Sign up at [MongoDB Atlas](https://mongodb.com/atlas)
2. Create a new cluster
3. Get your connection string
4. Add your server IP to network access

### 4. Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

## 📦 Application Deployment

### 1. Clone Repository

```bash
git clone <your-repo-url>
cd zappo
```

### 2. Install Dependencies

```bash
npm install --production
```

### 3. Configure Environment

```bash
# Copy example environment file
cp env.example .env

# Edit environment variables
nano .env
```

**Production Environment Variables:**
```env
# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/zappo

# Privy
PRIVY_APP_ID=your_production_privy_app_id
PRIVY_APP_SECRET=your_production_privy_app_secret

# Thirdweb
THIRDWEB_CLIENT_ID=your_production_thirdweb_client_id
THIRDWEB_CLIENT_SECRET=your_production_thirdweb_client_secret

# Security (Generate new keys for production)
ENCRYPTION_KEY=your_32_character_production_encryption_key
JWT_SECRET=your_production_jwt_secret

# Logging
LOG_LEVEL=warn
NODE_ENV=production
```

### 4. Create Directories

```bash
mkdir -p logs auth
chmod 755 logs auth
```

### 5. Test Configuration

```bash
# Test components
npm run test:components

# Test database connection
node -e "
const { initializeDatabase } = require('./src/services/database');
initializeDatabase().then(() => {
  console.log('✅ Database connection successful');
  process.exit(0);
}).catch(err => {
  console.error('❌ Database connection failed:', err);
  process.exit(1);
});
"
```

## 🚀 Production Deployment

### 1. Start with PM2

```bash
# Start the application
pm2 start src/index.js --name zappo

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### 2. Monitor Application

```bash
# View logs
pm2 logs zappo

# Monitor status
pm2 status

# Restart if needed
pm2 restart zappo
```

### 3. Setup Log Rotation

```bash
# Install logrotate
sudo apt install logrotate

# Create logrotate configuration
sudo nano /etc/logrotate.d/zappo
```

Add this content:
```
/home/ubuntu/zappo/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 ubuntu ubuntu
    postrotate
        pm2 reloadLogs
    endscript
}
```

## 🔒 Security Configuration

### 1. Firewall Setup

```bash
# Allow SSH, HTTP, HTTPS
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443

# Enable firewall
sudo ufw enable
```

### 2. SSL Certificate (Optional)

If you have a domain:

```bash
# Install Certbot
sudo apt install certbot

# Get SSL certificate
sudo certbot certonly --standalone -d yourdomain.com
```

### 3. Environment Security

```bash
# Secure environment file
chmod 600 .env

# Secure directories
chmod 700 auth
chmod 755 logs
```

## 📊 Monitoring & Maintenance

### 1. Health Check Script

Create `health-check.js`:
```javascript
const { initializeDatabase } = require('./src/services/database');
const { logger } = require('./src/utils/logger');

async function healthCheck() {
  try {
    // Check database
    await initializeDatabase();
    console.log('✅ Database: OK');
    
    // Check logs directory
    const fs = require('fs');
    if (fs.existsSync('./logs')) {
      console.log('✅ Logs: OK');
    }
    
    // Check auth directory
    if (fs.existsSync('./auth')) {
      console.log('✅ Auth: OK');
    }
    
    console.log('🎉 All systems operational');
    process.exit(0);
  } catch (error) {
    console.error('❌ Health check failed:', error);
    process.exit(1);
  }
}

healthCheck();
```

### 2. Automated Monitoring

```bash
# Create monitoring script
nano monitor.sh
```

Add this content:
```bash
#!/bin/bash
cd /path/to/zappo
node health-check.js
if [ $? -ne 0 ]; then
    echo "ZAPPO health check failed, restarting..."
    pm2 restart zappo
fi
```

```bash
# Make executable
chmod +x monitor.sh

# Add to crontab (check every 5 minutes)
crontab -e
# Add: */5 * * * * /path/to/zappo/monitor.sh
```

### 3. Backup Strategy

```bash
# Create backup script
nano backup.sh
```

Add this content:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/zappo"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup MongoDB
mongodump --uri="your_mongodb_uri" --out="$BACKUP_DIR/mongo_$DATE"

# Backup auth directory
tar -czf "$BACKUP_DIR/auth_$DATE.tar.gz" auth/

# Backup logs
tar -czf "$BACKUP_DIR/logs_$DATE.tar.gz" logs/

# Keep only last 7 days of backups
find $BACKUP_DIR -type f -mtime +7 -delete
```

## 🔄 Updates & Maintenance

### 1. Application Updates

```bash
# Pull latest changes
git pull origin main

# Install dependencies
npm install --production

# Restart application
pm2 restart zappo
```

### 2. Database Maintenance

```bash
# Connect to MongoDB
mongosh "your_mongodb_uri"

# Check database size
db.stats()

# Clean old logs (optional)
db.logs.deleteMany({timestamp: {$lt: new Date(Date.now() - 30*24*60*60*1000)}})
```

### 3. Log Management

```bash
# View recent logs
tail -f logs/zappo.log

# Check error logs
tail -f logs/error.log

# Archive old logs
tar -czf logs_archive_$(date +%Y%m%d).tar.gz logs/
```

## 🆘 Troubleshooting

### Common Issues

1. **WhatsApp Connection Issues**
   ```bash
   # Check auth directory
   ls -la auth/
   
   # Remove old session if needed
   rm -rf auth/*
   pm2 restart zappo
   ```

2. **Database Connection Issues**
   ```bash
   # Test MongoDB connection
   mongosh "your_mongodb_uri"
   
   # Check network connectivity
   ping your-mongodb-host
   ```

3. **Memory Issues**
   ```bash
   # Check memory usage
   free -h
   
   # Check PM2 memory usage
   pm2 monit
   ```

### Emergency Procedures

1. **Complete Restart**
   ```bash
   pm2 stop zappo
   pm2 delete zappo
   pm2 start src/index.js --name zappo
   ```

2. **Database Recovery**
   ```bash
   # Restore from backup
   mongorestore --uri="your_mongodb_uri" /path/to/backup
   ```

3. **Log Analysis**
   ```bash
   # Find errors
   grep -i error logs/zappo.log | tail -20
   
   # Find warnings
   grep -i warn logs/zappo.log | tail -20
   ```

## 📞 Support

- **Logs**: Check `logs/zappo.log` for detailed information
- **PM2**: Use `pm2 logs zappo` for real-time logs
- **Database**: Monitor MongoDB performance and connections
- **Network**: Ensure stable internet connection for WhatsApp

---

**Remember**: Always test updates in a staging environment before deploying to production!
