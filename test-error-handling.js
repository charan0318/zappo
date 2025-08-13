/**
 * Enhanced Error Handling Test Script
 * This script demonstrates the new error handling capabilities
 */

const errorHandler = require('./src/utils/errorHandler');
const errorRecovery = require('./src/utils/errorRecovery');

console.log('🧪 Testing Enhanced Error Handling System\n');

// Test different error scenarios
const testErrors = [
  new Error('Wallet not found'),
  new Error('Insufficient balance'),
  new Error('Transaction failed'),
  new Error('Network error occurred'),
  new Error('Invalid amount specified'),
  new Error('Rate limit exceeded'),
  new Error('Something completely unexpected happened')
];

testErrors.forEach((error, index) => {
  console.log(`\n📋 Test ${index + 1}: ${error.message}`);
  console.log('─'.repeat(50));
  
  const errorInfo = errorHandler.handleError(error, {
    action: 'test_action',
    phone: '+1234567890'
  });
  
  console.log(`🔍 Error Code: ${errorInfo.code}`);
  console.log(`📱 User Message: ${errorInfo.userMessage}`);
  console.log(`🔄 Retryable: ${errorInfo.retryable}`);
  console.log(`⚠️  Severity: ${errorInfo.severity}`);
  
  // Test enhanced message with recovery
  const enhancedMessage = errorRecovery.createEnhancedErrorMessage(errorInfo);
  console.log(`\n💬 Enhanced Message:\n${enhancedMessage}`);
});

console.log('\n✅ Error handling tests completed!');
console.log('\n🚀 Enhanced Error Handling Features:');
console.log('• 50+ specific error types categorized');
console.log('• User-friendly messages with emojis');
console.log('• Automatic retry logic with exponential backoff');
console.log('• Recovery suggestions for common issues');
console.log('• Error severity tracking');
console.log('• Silent fallbacks for non-critical operations');
console.log('• Production-ready logging and monitoring');
