#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🧹 Clearing all WhatsApp sessions...');

try {
  // Remove auth directory
  if (fs.existsSync('auth')) {
    fs.rmSync('auth', { recursive: true, force: true });
    console.log('✅ Auth directory cleared');
  }
  
  // Clear any session files
  const sessionFiles = ['session.json', 'session.json.backup', 'auth_info.json'];
  for (const file of sessionFiles) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`✅ ${file} removed`);
    }
  }
  
  console.log('✅ All sessions cleared successfully!');
  console.log('🔄 Restart your ZAPPO bot to scan a new QR code');
  
} catch (error) {
  console.error('❌ Error clearing sessions:', error.message);
}
