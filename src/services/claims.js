const crypto = require('crypto');
const { claims } = require('./database');
const { logger } = require('../utils/logger');
const config = require('../config');
const privyService = require('./privy');
const nebulaService = require('./nebula');

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildClaimLink(token) {
  const encoded = encodeURIComponent(`CLAIM ${token}`);
  return `https://wa.me/${config.escrow.botNumber}?text=${encoded}`;
}

function expiryDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

class ClaimsService {
  async createHold({ senderPhone, senderAddress, recipientPhone, amountAvax, ephemeralWalletId, ephemeralWalletAddress, holdTxHash }) {
    try {
      // Validate input parameters
      if (!senderPhone || !senderAddress || !recipientPhone || !amountAvax || !ephemeralWalletId || !ephemeralWalletAddress) {
        logger.error('Missing required parameters for createHold:', { 
          senderPhone, senderAddress, recipientPhone, amountAvax, ephemeralWalletId, ephemeralWalletAddress 
        });
        throw new Error('Missing required parameters for creating escrow hold');
      }
      
      logger.info(`Creating escrow hold: ${senderPhone} -> ${recipientPhone}, amount: ${amountAvax} AVAX`);
      
      const token = generateToken();
      const tokenHash = hashToken(token);
      const expiresAt = expiryDate(config.escrow.expiryDays);
      
      const claimData = {
        sender_phone: senderPhone,
        sender_wallet_address: senderAddress,
        recipient_phone: recipientPhone,
        token_hash: tokenHash,
        ephemeral_wallet_id: ephemeralWalletId,
        ephemeral_wallet_address: ephemeralWalletAddress,
        amount_avax: amountAvax,
        status: 'pending',
        hold_tx_hash: holdTxHash,
        expires_at: expiresAt
      };
      
      await claims.createClaim(claimData);
      logger.info(`Escrow hold created: token=${token.substring(0, 8)}..., expires=${expiresAt}`);
      
      const link = buildClaimLink(token);
      return { link, token };
      
    } catch (error) {
      logger.error('Failed to create escrow hold:', error);
      throw error;
    }
  }
  
  async validateAndClaim({ tokenPlain, claimerPhone, recipientWalletAddress }) {
    try {
      // Validate input parameters
      if (!tokenPlain || !claimerPhone || !recipientWalletAddress) {
        logger.error('Missing required parameters for claim:', { tokenPlain, claimerPhone, recipientWalletAddress });
        throw new Error('Missing required parameters for claim. Please check the claim link and try again.');
      }
      
      logger.info(`Validating claim: token=${tokenPlain?.substring(0, 8)}..., claimer=${claimerPhone}, recipient=${recipientWalletAddress?.substring(0, 10)}...`);
      
      const tokenHash = hashToken(tokenPlain);
      const record = await claims.findByTokenHash(tokenHash);
      
      if (!record) {
        logger.warn(`Claim attempt with invalid token hash: ${tokenHash}`);
        throw new Error('Invalid or expired claim link. Please check the link and try again.');
      }
      
      logger.info(`Found claim record: ${record._id}, status: ${record.status}, recipient: ${record.recipient_phone}`);
      
      if (record.status !== 'pending') {
        logger.warn(`Claim attempt on non-pending record: ${record._id}, status: ${record.status}`);
        throw new Error(`This claim link is no longer active (status: ${record.status}). Please contact the sender for a new link.`);
      }
      
      if (record.recipient_phone !== claimerPhone) {
        logger.warn(`Phone number mismatch: expected ${record.recipient_phone}, got ${claimerPhone}`);
        throw new Error('This claim link is not intended for this phone number. Please ask the sender to send you the correct link.');
      }
      
      if (record.expires_at && new Date(record.expires_at) < new Date()) {
        logger.warn(`Claim attempt on expired record: ${record._id}, expired: ${record.expires_at}`);
        throw new Error('This claim link has expired. The funds have been automatically refunded to the sender.');
      }
      
      // Estimate gas for sweeping funds
      logger.info(`Estimating gas for claim: ${record.ephemeral_wallet_address} -> ${recipientWalletAddress}, amount: ${record.amount_avax}`);
      
      const privyWallet = await privyService.getWalletProvider(null, false, record.ephemeral_wallet_id);
      if (!privyWallet) {
        logger.error(`Failed to get Privy wallet provider for ephemeral wallet: ${record.ephemeral_wallet_id}`);
        throw new Error('Unable to access the escrow wallet. Please try again later or contact support.');
      }
      
      const gasEstimate = await nebulaService.estimateGas(record.ephemeral_wallet_address, recipientWalletAddress, record.amount_avax);
      if (!gasEstimate || !gasEstimate.estimatedCost) {
        logger.error(`Gas estimation failed for claim: ${record._id}`);
        throw new Error('Unable to estimate transaction fees. Please try again later.');
      }
      
      // Improved gas calculation with dynamic buffer
      const gasCost = parseFloat(gasEstimate.estimatedCost);
      const availableAmount = record.amount_avax;
      
      // Calculate dynamic gas buffer based on amount size
      const minGasBuffer = 0.0005; // Minimum 0.0005 AVAX
      const dynamicGasBuffer = Math.max(minGasBuffer, availableAmount * 0.1); // 10% of amount or min buffer
      const maxGasBuffer = 0.001; // Cap at 0.001 AVAX for small amounts
      const gasBuffer = Math.min(dynamicGasBuffer, maxGasBuffer);
      
      const totalGasNeeded = gasCost + gasBuffer;
      
      logger.info(`Improved gas estimation: cost=${gasCost}, dynamicBuffer=${gasBuffer}, total=${totalGasNeeded}, available=${availableAmount}`);
      
      // Better validation with clearer conditions
      if (totalGasNeeded >= availableAmount * 0.9) { // If gas is more than 90% of amount
        const recommendedMin = (totalGasNeeded * 1.5).toFixed(6);
        logger.warn(`Amount too small for gas fees: required=${totalGasNeeded}, available=${availableAmount}, recommended=${recommendedMin}`);
        throw new Error(`Amount too small for gas fees. Minimum recommended: ${recommendedMin} AVAX`);
      }
      
      // Ensure minimum claimable amount after gas
      const netAmount = availableAmount - totalGasNeeded;
      if (netAmount < 0.0001) { // Minimum 0.0001 AVAX after gas
        const recommendedMin = (totalGasNeeded + 0.0001).toFixed(6);
        logger.warn(`Net amount too small after gas: net=${netAmount}, recommended=${recommendedMin}`);
        throw new Error(`Amount too small after gas fees. Send at least ${recommendedMin} AVAX`);
      }
      
      // Calculate amount after deducting gas fees (use actual gas cost, not buffer)
      const transferAmount = availableAmount - gasCost;
      
      logger.info(`Proceeding with claim: transfer=${transferAmount}, gas=${gasCost}, buffer=${gasBuffer}`);
      
      // Sweep funds from ephemeral to recipient (amount minus gas)
      const tx = await nebulaService.sendTransaction(privyWallet, recipientWalletAddress, transferAmount);
      
      if (!tx || !tx.hash) {
        logger.error(`Transaction failed for claim: ${record._id}`);
        throw new Error('Transaction failed. Please try again later or contact support.');
      }
      
      logger.info(`Claim transaction successful: ${tx.hash}`);
      
      await claims.updateClaimById(record._id, { 
        status: 'claimed', 
        claim_tx_hash: tx.hash,
        gas_cost: gasCost,
        transfer_amount: transferAmount,
        claimed_at: new Date()
      });
      
      return { tx, gasCost, transferAmount };
      
    } catch (error) {
      logger.error('Claim validation failed:', { 
        tokenPlain: tokenPlain?.substring(0, 8), 
        claimerPhone, 
        error: error.message,
        stack: error.stack 
      });
      throw error;
    }
  }
  
  async refundExpired(refundHandler) {
    const now = new Date();
    const expired = await claims.findExpiringPending(now);
    for (const rec of expired) {
      try {
        const privyWallet = await privyService.getWalletProvider(null, false, rec.ephemeral_wallet_id);
        
        // Estimate gas for refund
        const gasEstimate = await nebulaService.estimateGas(rec.ephemeral_wallet_address, rec.sender_wallet_address, rec.amount_avax);
        const gasCost = parseFloat(gasEstimate.estimatedCost);
        const safetyBuffer = config.escrow.claimMinGasBuffer || 0.002;
        const totalRequired = gasCost + safetyBuffer;
        
        if (rec.amount_avax <= totalRequired) {
          logger.warn(`Refund failed: insufficient funds for gas. Required: ${totalRequired.toFixed(6)} AVAX, Available: ${rec.amount_avax} AVAX`);
          await claims.updateClaimById(rec._id, { 
            status: 'failed', 
            error: 'Insufficient funds for gas fees'
          });
          continue;
        }
        
        // Calculate refund amount after deducting gas
        const refundAmount = rec.amount_avax - gasCost;
        
        const tx = await nebulaService.sendTransaction(privyWallet, rec.sender_wallet_address, refundAmount);
        await claims.updateClaimById(rec._id, { 
          status: 'refunded', 
          refund_tx_hash: tx.hash,
          gas_cost: gasCost,
          refund_amount: refundAmount
        });
        
        if (refundHandler) await refundHandler(rec, tx, gasCost, refundAmount);
      } catch (e) {
        logger.error('Refund failed for claim', rec._id, e);
        await claims.updateClaimById(rec._id, { 
          status: 'failed', 
          error: e.message
        });
      }
    }
  }
  
  // Find claims expiring within window for reminders
  async findPendingForReminderRange(start, end) {
    return await claims.findPendingForReminder(start, end);
  }
}

module.exports = new ClaimsService();


