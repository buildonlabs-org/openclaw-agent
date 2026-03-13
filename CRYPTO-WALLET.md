# Agent Crypto Wallet

## Overview

Every OpenClaw agent automatically gets an **EVM-compatible crypto wallet** on first startup. This enables on-chain operations for DeFi trading, token transfers, NFT minting, and more.

## Features

✅ **Auto-generated** - Wallet created automatically on first startup  
✅ **EVM Compatible** - Works with Ethereum, Polygon, Base, Arbitrum, Optimism, BSC, Avalanche, etc.  
✅ **Encrypted Storage** - Private key encrypted at rest using AES-256-GCM  
✅ **Persistent** - Add to env vars to preserve across deployments  
✅ **Secure** - Private key never exposed in logs (only shown once at generation)  

## Quick Start

### 1. Ask Your Agent for Its Wallet

The agent knows its own wallet address! Just ask:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is your crypto wallet address?"}' \
  https://your-agent.up.railway.app/api/chat
```

Or via API:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.up.railway.app/api/wallet
```

**Response:**
```json
{
  "ok": true,
  "initialized": true,
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "type": "EVM",
  "chains": ["Ethereum", "Polygon", "Base", "Arbitrum", "..."],
  "note": "Fund this address to enable on-chain operations"
}
```

### 2. Fund Your Wallet

Send crypto to the wallet address:
- **Testnets** (for testing): Get free tokens from faucets
  - Sepolia ETH: https://sepoliafaucet.com/
  - Mumbai MATIC: https://faucet.polygon.technology/
  - Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet

- **Mainnets** (for production): Send real tokens from an exchange or wallet

### 3. Export Private Key (Optional - for persistence)

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://your-agent.up.railway.app/api/wallet/export?confirm=yes"
```

⚠️ **Security Warning:** Keep this private! Anyone with the private key controls the funds.

### 4. Persist Across Deployments

Add to Railway environment variables:

```bash
railway variables set AGENT_WALLET_PRIVATE_KEY="0x..."
```

Or in Railway dashboard:
1. Go to Variables tab
2. Add **AGENT_WALLET_PRIVATE_KEY**
3. Paste your private key
4. Save and redeploy

## Using with Skills

### Hyperliquid Trading

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Check my Hyperliquid account balance"}' \
  https://your-agent.up.railway.app/api/chat
```

### On-chain Operations

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Send 0.1 ETH to 0x1234... on Base"}' \
  https://your-agent.up.railway.app/api/chat
```

## API Endpoints

### GET /api/wallet

Get wallet information (address, supported chains).

**Response:**
```json
{
  "ok": true,
  "address": "0x...",
  "type": "EVM",
  "chains": ["Ethereum", "Polygon", "..."]
}
```

### POST /api/wallet/sign

Sign a message with the agent's wallet.

**Request:**
```json
{
  "message": "Hello, World!"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Hello, World!",
  "signature": "0x...",
  "address": "0x..."
}
```

### GET /api/wallet/export?confirm=yes

Export the private key. **Use with extreme caution!**

**Response:**
```json
{
  "ok": true,
  "address": "0x...",
  "privateKey": "0x...",
  "warning": "⚠️ KEEP THIS PRIVATE!",
  "instructions": "Add to Railway env var: AGENT_WALLET_PRIVATE_KEY"
}
```

## Security Best Practices

### ✅ Do:
- Export and save private key immediately after first deployment
- Add private key to Railway environment variables
- Use testnet tokens for testing
- Start with small amounts on mainnet
- Monitor wallet balance regularly

### ❌ Don't:
- Share your private key with anyone
- Commit private keys to git
- Use the same wallet for multiple agents without careful consideration
- Fund with large amounts until you've tested thoroughly

## Wallet Storage

Wallets are stored in the persistent volume at:
```
/data/.openclaw/wallet.json
```

The file contains:
- Wallet address (public)
- Encrypted private key
- Encryption metadata

The private key is encrypted using AES-256-GCM with a key derived from your gateway token.

## Troubleshooting

### Wallet shows as "not initialized"

Wait 10-20 seconds after deployment. The wallet is created during server startup.

### Lost private key after redeployment

Without a volume or `AGENT_WALLET_PRIVATE_KEY` env var, the wallet is ephemeral. Always:
1. Export private key after first deployment
2. Add to Railway environment variables
3. Or enable persistent volume (already configured in railway.toml)

### Need a new wallet

Delete `/data/.openclaw/wallet.json` and remove `AGENT_WALLET_PRIVATE_KEY` env var. A new wallet will be generated on next restart.

## Multi-Chain Support

The same wallet address works across **all EVM chains**:
- Ethereum (mainnet, Sepolia)
- Polygon (mainnet, Mumbai)
- Base (mainnet, Sepolia)
- Arbitrum (mainnet, Sepolia)
- Optimism (mainnet, Sepolia)
- BSC (mainnet, testnet)
- Avalanche C-Chain
- Any other EVM-compatible chain

Just connect to different RPC endpoints in your skills!

## Example Use Cases

### DeFi Trading Bot
```
Agent analyzes DEX prices → Makes trades on Uniswap/PancakeSwap
```

### NFT Operations
```
Agent monitors collections → Mints/buys NFTs when criteria met
```

### Token Automation
```
Agent receives tokens → Automatically swaps or distributes them
```

### Cross-chain Bridge
```
Agent bridges assets between chains based on logic
```

### Portfolio Management
```
Agent rebalances portfolio across multiple protocols
```

## Additional Resources

- **Ethers.js Docs**: https://docs.ethers.org/
- **EVM Chains List**: https://chainlist.org/
- **Testnet Faucets**: https://faucetlink.to/
- **Gas Fee Tracker**: https://www.gasnow.org/

---

**Need help?** Open an issue: https://github.com/buildon
labs-org/openclaw-agent/issues
