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
      
      // Check if amount covers gas fees with safety buffer
      const gasCost = parseFloat(gasEstimate.estimatedCost);
      const safetyBuffer = config.escrow.claimMinGasBuffer || 0.002; // Default 0.002 AVAX buffer
      const totalRequired = gasCost + safetyBuffer;
      
      logger.info(`Gas estimation: cost=${gasCost}, buffer=${safetyBuffer}, total=${totalRequired}, available=${record.amount_avax}`);
      
      if (record.amount_avax <= totalRequired) {
        logger.warn(`Insufficient funds for gas: required=${totalRequired}, available=${record.amount_avax}`);
        throw new Error(`Insufficient funds to cover network fees. Required: ${totalRequired.toFixed(6)} AVAX, Available: ${record.amount_avax} AVAX. Please ask the sender to increase the amount.`);
      }
      
      // Calculate amount after deducting gas fees
      const transferAmount = record.amount_avax - gasCost;
      
      logger.info(`Proceeding with claim: transfer=${transferAmount}, gas=${gasCost}`);
      
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


