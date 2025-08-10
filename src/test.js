const commandParser = require('./parsers/commandParser');
const { logger } = require('./utils/logger');

// Test command parsing
function testCommandParsing() {
  console.log('🧪 Testing Command Parser...\n');
  
  const testCases = [
    '/help',
    '/balance',
    '/history',
    'create wallet',
    'import wallet',
    'send 1 AVAX to 0x1234567890123456789012345678901234567890',
    '/send 0.5 AVAX to John',
    'what is my balance?',
    'show transaction history',
    'transfer 2 to 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    '/addcontact Alice 0x1234567890123456789012345678901234567890'
  ];
  
  testCases.forEach((input, index) => {
    console.log(`Test ${index + 1}: "${input}"`);
    const result = commandParser.parseInput(input);
    console.log(`  Intent: ${result.intent}`);
    console.log(`  Confidence: ${result.confidence}`);
    console.log(`  Parameters:`, result.parameters);
    console.log('');
  });
}

// Test help text
function testHelpText() {
  console.log('📋 Testing Help Text...\n');
  console.log(commandParser.getHelpText());
  console.log('');
}

// Test validation functions
function testValidation() {
  console.log('✅ Testing Validation Functions...\n');
  
  // Test address validation
  const validAddress = '0x1234567890123456789012345678901234567890';
  const invalidAddress = '0x123';
  
  console.log(`Valid address "${validAddress}": ${commandParser.validateAddress(validAddress)}`);
  console.log(`Invalid address "${invalidAddress}": ${commandParser.validateAddress(invalidAddress)}`);
  
  // Test amount validation
  console.log(`Valid amount 1.5: ${commandParser.validateAmount(1.5)}`);
  console.log(`Invalid amount -1: ${commandParser.validateAmount(-1)}`);
  console.log(`Invalid amount 0: ${commandParser.validateAmount(0)}`);
  console.log(`Valid amount 1000000: ${commandParser.validateAmount(1000000)}`);
  console.log(`Invalid amount 1000001: ${commandParser.validateAmount(1000001)}`);
  
  // Test confirmation/cancellation
  console.log(`Confirmation "yes": ${commandParser.isConfirmation('yes')}`);
  console.log(`Confirmation "no": ${commandParser.isConfirmation('no')}`);
  console.log(`Cancellation "cancel": ${commandParser.isCancellation('cancel')}`);
  console.log(`Cancellation "yes": ${commandParser.isCancellation('yes')}`);
  
  console.log('');
}

// Test send parameter parsing
function testSendParsing() {
  console.log('📤 Testing Send Parameter Parsing...\n');
  
  const testCases = [
    '1 AVAX to 0x1234567890123456789012345678901234567890',
    '0.5 to John',
    '2 AVAX to 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    'invalid format',
    '10 to'
  ];
  
  testCases.forEach((input, index) => {
    console.log(`Test ${index + 1}: "${input}"`);
    const result = commandParser.parseSendParameters(input);
    console.log(`  Valid: ${result.valid}`);
    if (result.valid) {
      console.log(`  Amount: ${result.amount}`);
      console.log(`  Recipient: ${result.recipient}`);
    } else {
      console.log(`  Error: ${result.error}`);
    }
    console.log('');
  });
}

// Main test function
function runTests() {
  console.log('🚀 ZAPPO Bot - Component Tests\n');
  console.log('=' .repeat(50) + '\n');
  
  try {
    testCommandParsing();
    testHelpText();
    testValidation();
    testSendParsing();
    
    console.log('✅ All tests completed successfully!');
    console.log('\n🎉 ZAPPO bot components are working correctly.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = {
  testCommandParsing,
  testHelpText,
  testValidation,
  testSendParsing,
  runTests
};
