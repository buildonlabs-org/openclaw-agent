# Agent Crypto Wallet

## Overview

Every OpenClaw agent **automatically gets an EVM-compatible crypto wallet** on first startup. The wallet **persists automatically** via the Railway persistent volume - **zero configuration required!**

## Features

✅ **100% Automatic** - Wallet created and persisted automatically  
✅ **Zero Configuration** - No environment variables or setup needed  
✅ **Persistent Volume** - Survives all deployments and restarts  
✅ **EVM Compatible** - Works with Ethereum, Polygon, Base, Arbitrum, Optimism, BSC, Avalanche, etc.  
✅ **Encrypted Storage** - Private key encrypted at rest using AES-256-GCM  
✅ **Secure** - Private key never exposed (only shown once at generation)  

## How It Works

1. **First Deployment**: Agent generates a new wallet and saves to `/data/.openclaw/wallet.json`
2. **Future Deployments**: Agent loads the same wallet from the persistent volume
3. **No Action Needed**: Everything happens automatically!

The persistent volume (`/data`) is configured in `railway.toml` and survives all deployments.

## Quick Start

### 1. Deploy Your Agent

Just deploy! The wallet is created automatically on first startup.

### 2. Check Deployment Logs

Look for:
```
[wallet] ✅ New wallet created!
[wallet] Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
[wallet] 🔒 Wallet is automatically persisted to the persistent volume.
[wallet] 🔄 Same wallet will be loaded on future deployments automatically.
```

### 3. Get Your Agent's Wallet Address

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
  "chains": ["Ethereum", "Polygon", "Base", "Arbitrum", "Optimism", "BSC", "Avalanche"],
  "note": "Fund this address with ETH/MATIC/etc to enable crypto trading and on-chain operations"
}
```

### 5. Fund Your Wallet

Send crypto to the wallet address:
- **Testnets** (for testing): Get free tokens from faucets
  - Sepolia ETH: https://sepoliafaucet.com/
  - Mumbai MATIC: https://faucet.polygon.technology/
  - Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet

- **Mainnets** (for production): Send real tokens from an exchange or wallet

## RaRailway provides automatically**: `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID`
2. **You add**: `RAILWAY_TOKEN` (API token from railway.app/account/tokens)
3. **On first wallet generation**, the agent checks for these credentials
4. **If found**, it calls Railway's API to set `AGENT_WALLET_PRIVATE_KEY`
5. **On next deployment**, the wallet is automatically loaded from env var

### Required Variable for Auto-Config

**Only one variable needed:**
```bash
RAILWAY_TOKEN=<api-token>              # From railway.app/account/tokens
```

Railway automatically provides:
- `RAILWAY_PROJECT_ID` ✅ Auto-provided
- `RAILWAY_ENVIRONMENT_ID` ✅ Auto-provided
- `RAILWAY_SERVICE_ID` ✅ Auto-provided

---

## API Endpoints

### GET /api/wallet

Get wallet information (address, supported chains).

**Response:**
```json
{
  "ok": true,
  "initialized": true,
  "address": "0x...",
  "type": "EVM",
  "chains": ["Ethereum", "Polygon", "Base", "Arbitrum", "Optimism", "BSC", "Avalanche"],
  "note": "Fund this address with ETH/MATIC/etc to enable crypto trading"
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

## Security Best Practices

### ✅ Do:
- Let the wallet auto-generate on first deployment
- Fund the wallet address once generated
- Export private key for backup (optional)
- Use testnet tokens for testing
- Start with small amounts on mainnet

### ❌ Don't:
- Share your private key with anyone
- Commit private keys to git
- Delete the persistent volume without backing up
- Fund with large amounts until you've tested thoroughly

---

## Backup & Restore (Optional)

### Backup Your Wallet

Export the private key for safekeeping:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "https://your-agent.up.railway.app/api/wallet/export?confirm=yes"
```

Save the private key securely (password manager, hardware wallet, etc.).

### Restore a Wallet

To restore from backup, set the environment variable:

```bash
# Via Railway CLI
railway variables set AGENT_WALLET_PRIVATE_KEY="0x..."

# Or via Railway Dashboard
# Variables tab → Add AGENT_WALLET_PRIVATE_KEY
```

The agent will load this wallet on next startup.

---

## Troubleshooting

### Wallet shows as "not initialized"

**Cause:** Wallet is still being created (happens during server startup).

**Solution:** Wait 10-20 seconds and check again.

### Lost access to wallet

**If you have the persistent volume:**
- The wallet is at `/data/.openclaw/wallet.json`
- It will auto-load on restart
- No action needed!

**If volume was deleted:**
- Check deployment logs for the private key (shown once at generation)
- Or if you backed it up, set `AGENT_WALLET_PRIVATE_KEY` env var
- Otherwise, a new wallet will be generated

### Want to use a different wallet

**Option 1:** Delete and regenerate
1. Delete `/data/.openclaw/wallet.json`  
2. Remove `AGENT_WALLET_PRIVATE_KEY` env var (if set)
3. Restart - new wallet will be generated

**Option 2:** Import existing wallet
1. Set `AGENT_WALLET_PRIVATE_KEY="0x..."` env var
2. Restart - agent will use your wallet

### Volume persistence not working

**Symptoms:** New wallet generated on every deployment

**Possible causes:**
- Persistent volume not configured correctly
- Volume was deleted/recreated
- `railway.toml` not being used

**Solution:** 
1. Verify `railway.toml` has the volume configuration:
   ```toml
   [[volumes]]
   name = "data"
   mountPath = "/data"
   sizeGB = 5
   ```
2. Redeploy to apply configuration
3. As a workaround, set `AGENT_WALLET_PRIVATE_KEY` to persist via env var

---

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
