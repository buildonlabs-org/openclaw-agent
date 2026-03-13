// wallet.js - Crypto wallet management for agents
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

/**
 * Initialize or load agent's crypto wallet
 * Supports EVM chains (Ethereum, Polygon, Base, Arbitrum, etc.)
 */
export class AgentWallet {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.walletPath = path.join(stateDir, "wallet.json");
    this.wallet = null;
  }

  /**
   * Load existing wallet or generate new one
   * Can also import from AGENT_WALLET_PRIVATE_KEY env var
   */
  async initialize() {
    // Priority 1: Check environment variable for existing wallet
    const envPrivateKey = process.env.AGENT_WALLET_PRIVATE_KEY?.trim();
    if (envPrivateKey) {
      try {
        this.wallet = new ethers.Wallet(envPrivateKey);
        console.log(`[wallet] Imported wallet from AGENT_WALLET_PRIVATE_KEY`);
        console.log(`[wallet] Address: ${this.wallet.address}`);
        
        // Save to file for consistency
        this._saveWallet(this.wallet.privateKey);
        return this.wallet;
      } catch (err) {
        console.error(`[wallet] Invalid AGENT_WALLET_PRIVATE_KEY: ${err.message}`);
        // Fall through to generate new wallet
      }
    }

    // Priority 2: Load from persisted file
    if (fs.existsSync(this.walletPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.walletPath, "utf8"));
        
        // Decrypt private key
        const privateKey = this._decrypt(data.encryptedKey, data.iv, data.tag);
        this.wallet = new ethers.Wallet(privateKey);
        
        console.log(`[wallet] Loaded existing wallet`);
        console.log(`[wallet] Address: ${this.wallet.address}`);
        return this.wallet;
      } catch (err) {
        console.error(`[wallet] Failed to load wallet: ${err.message}`);
        // Fall through to generate new wallet
      }
    }

    // Priority 3: Generate new wallet
    console.log(`[wallet] Generating new wallet...`);
    this.wallet = ethers.Wallet.createRandom();
    this._saveWallet(this.wallet.privateKey);
    
    console.log(`[wallet] ✅ New wallet created!`);
    console.log(`[wallet] Address: ${this.wallet.address}`);
    console.log(`[wallet] Private Key (backup/export only): ${this.wallet.privateKey}`);
    console.log(`[wallet] `);
    console.log(`[wallet] 🔒 Wallet is automatically persisted to the persistent volume.`);
    console.log(`[wallet] 🔄 Same wallet will be loaded on future deployments automatically.`);
    console.log(`[wallet] 💾 Stored at: ${this.walletPath}`);
    console.log(`[wallet] `);
    console.log(`[wallet] To backup/restore this wallet (optional):`);
    console.log(`[wallet] 1. Save private key securely`);
    console.log(`[wallet] 2. Set as env var: AGENT_WALLET_PRIVATE_KEY="${this.wallet.privateKey}"`);
    console.log(`[wallet] 3. Or export via API: /api/wallet/export?confirm=yes`);
    
    return this.wallet;
  }

  /**
   * Save wallet to encrypted file on persistent volume
   */
  _saveWallet(privateKey) {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      
      // Encrypt private key before storing
      const { encrypted, iv, tag } = this._encrypt(privateKey);
      
      const data = {
        address: new ethers.Wallet(privateKey).address,
        encryptedKey: encrypted,
        iv: iv,
        tag: tag,
        createdAt: new Date().toISOString(),
        version: "1.0"
      };
      
      fs.writeFileSync(this.walletPath, JSON.stringify(data, null, 2), { mode: 0o600 });
      console.log(`[wallet] Saved to ${this.walletPath}`);
    } catch (err) {
      console.error(`[wallet] Failed to save wallet: ${err.message}`);
    }
  }

  /**
   * Encrypt data using AES-256-GCM
   * Uses gateway token as encryption key
   */
  _encrypt(data) {
    const key = this._getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    
    let encrypted = cipher.update(data, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex")
    };
  }

  /**
   * Decrypt data
   */
  _decrypt(encrypted, ivHex, tagHex) {
    const key = this._getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  }

  /**
   * Derive encryption key from gateway token
   */
  _getEncryptionKey() {
    const token = process.env.OPENCLAW_GATEWAY_TOKEN || "default-encryption-key";
    return crypto.createHash("sha256").update(token).digest();
  }

  /**
   * Get wallet info (safe to expose via API)
   */
  getInfo() {
    if (!this.wallet) {
      return { initialized: false };
    }
    
    return {
      initialized: true,
      address: this.wallet.address,
      type: "EVM",
      chains: [
        "Ethereum",
        "Polygon", 
        "Base",
        "Arbitrum",
        "Optimism",
        "BSC",
        "Avalanche"
      ]
    };
  }

  /**
   * Sign a message
   */
  async signMessage(message) {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }
    return await this.wallet.signMessage(message);
  }

  /**
   * Get private key (use with extreme caution!)
   */
  getPrivateKey() {
    if (!this.wallet) {
      throw new Error("Wallet not initialized");
    }
    return this.wallet.privateKey;
  }
}

/**
 * Initialize wallet singleton
 */
export async function initializeWallet(stateDir) {
  const wallet = new AgentWallet(stateDir);
  await wallet.initialize();
  return wallet;
}
