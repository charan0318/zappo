const nebulaService = require('./src/services/nebula');
const walletHandler = require('./src/handlers/walletHandler');
const privyService = require('./src/services/privy');
const { logger } = require('./src/utils/logger');

async function testTransaction() {
  try {
    logger.info('🧪 Testing transaction functionality...');
    
    // Test phone number (the one that sent the message)
    const testPhone = '919150660402';
    
    // Check if user exists and has a wallet
    const userWallet = await walletHandler.getUserWallet(testPhone);
    if (!userWallet) {
      logger.error('❌ User wallet not found');
      return;
    }
    
    logger.info('✅ User wallet found:', {
      address: userWallet.address,
      balance: userWallet.balance
    });
    
    // Get wallet provider
    const walletProvider = await walletHandler.getWalletProvider(testPhone);
    logger.info('✅ Wallet provider obtained:', {
      isPrivyWallet: walletProvider.isPrivyWallet,
      hasSignTransaction: typeof walletProvider.signTransaction === 'function',
      hasSendTransaction: typeof walletProvider.sendTransaction === 'function'
    });
    
    // Test address to send to (a dummy address)
    const testToAddress = '0x742d35Cc6Bf4532C29bF2EbEE9cB36C4d1Ac82';
    const testAmount = 0.001; // Very small test amount
    
    // Test gas estimation first
    const gasEstimate = await nebulaService.estimateGas(
      userWallet.address,
      testToAddress,
      testAmount
    );
    
    logger.info('✅ Gas estimation successful:', gasEstimate);
    
    // Check if user has enough balance
    const currentBalance = parseFloat(userWallet.balance);
    const totalCost = testAmount + parseFloat(gasEstimate.estimatedCost);
    
    if (totalCost > currentBalance) {
      logger.error('❌ Insufficient balance for test transaction');
      logger.info(`Need: ${totalCost}, Have: ${currentBalance}`);
      return;
    }
    
    logger.info('✅ Sufficient balance for test transaction');
    logger.info('🚀 Attempting to send test transaction...');
    
    // Attempt the transaction
    const txResult = await nebulaService.sendTransaction(
      walletProvider,
      testToAddress,
      testAmount
    );
    
    logger.info('✅ Transaction successful!', txResult);
    
  } catch (error) {
    logger.error('❌ Transaction test failed:', error);
  }
}

// Run the test
testTransaction().then(() => {
  logger.info('🏁 Transaction test completed');
  process.exit(0);
}).catch(error => {
  logger.error('💥 Fatal error in transaction test:', error);
  process.exit(1);
});
