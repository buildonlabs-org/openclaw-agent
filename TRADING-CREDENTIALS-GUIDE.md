# Trading Credentials Setup Guide

## Overview

When you ask your OpenClaw agent to trade on platforms like Polymarket or Hyperliquid, it needs proper credentials configured. Instead of receiving a generic "ACP runtime configuration error," the agent now provides **specific guidance** on which environment variables you need to set up in Railway.

## How It Works

1. **User sends trading request**: "Can you trade on Polymarket?"
2. **Gateway validates credentials**: Checks for required API keys
3. **Helpful error returned**: If keys are missing, tells you exactly what to add
4. **Easy setup**: Follow the instructions to add variables in Railway

## Required Credentials by Platform

### Polymarket Trading

To trade on Polymarket, you need:

1. **Crypto Wallet** (auto-generated or provide your own)
2. **Polymarket API Key**

**Railway Variables to Set:**
```bash
# Option 1: Use Polymarket API Key (recommended)
POLYMARKET_API_KEY=your_api_key_here

# Option 2: Use Polymarket wallet private key
POLYMARKET_PRIVATE_KEY=0x...

# If you want to provide your own crypto wallet:
AGENT_WALLET_PRIVATE_KEY=0x...
```

**Get Polymarket API Key:**
1. Go to [polymarket.com/settings](https://polymarket.com/settings)
2. Generate API key
3. Copy and add to Railway Variables

### Hyperliquid Trading

To trade on Hyperliquid, you need:

1. **Crypto Wallet** (auto-generated or provide your own)
2. **Hyperliquid API credentials**

**Railway Variables to Set:**
```bash
# Option 1: Use Hyperliquid API Key (recommended)
HYPERLIQUID_API_KEY=your_api_key_here

# Option 2: Use Hyperliquid wallet private key
HYPERLIQUID_PRIVATE_KEY=0x...

# If you want to provide your own crypto wallet:
AGENT_WALLET_PRIVATE_KEY=0x...
```

**Get Hyperliquid API Key:**
1. Go to [hyperliquid.xyz/settings](https://hyperliquid.xyz/settings)
2. Generate API key
3. Copy and add to Railway Variables

### General DeFi Trading (Uniswap, etc.)

For general DeFi operations, you only need a funded wallet:

**Railway Variables to Set:**
```bash
# Provide a wallet with funds
AGENT_WALLET_PRIVATE_KEY=0x...
```

## Setting Up in Railway

### Step 1: Go to Variables Tab

1. Open your Railway project
2. Click on your service
3. Go to "Variables" tab

### Step 2: Add Required Variables

Click "New Variable" and add the required keys:

```
POLYMARKET_API_KEY = your_key_here
```

Or:

```
HYPERLIQUID_API_KEY = your_key_here
```

### Step 3: Redeploy (Automatic)

Railway automatically redeploys when you add/change variables.

### Step 4: Test

Try your trading command again:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Can you trade on Polymarket?"}' \
  https://your-agent.railway.app/api/chat
```

## Example Error Messages

### Before Setup (Missing Credentials)

```json
{
  "ok": false,
  "error": "Trading credentials not configured",
  "missingKeys": ["POLYMARKET_API_KEY or POLYMARKET_PRIVATE_KEY"],
  "setupInstructions": "⚠️ **Polymarket Credentials Required**\n\nTo trade on Polymarket, add one of these in Railway Variables:\n- `POLYMARKET_API_KEY` (preferred) - Get from polymarket.com/settings\n- OR `POLYMARKET_PRIVATE_KEY` - Your Polymarket wallet private key",
  "helpUrl": "https://github.com/buildonlabs-org/openclaw-agent#crypto-wallet",
  "platform": "polymarket"
}
```

### After Setup (Credentials Configured)

```json
{
  "ok": true,
  "response": "I can help you trade on Polymarket! What market are you interested in?",
  "agentId": "main",
  "sessionKey": "api-session-123456789"
}
```

## Wallet Setup

### Auto-Generated Wallet

Your agent automatically generates a wallet on first startup. You just need to:

1. Get the wallet address: `/api/wallet`
2. Fund it with ETH, MATIC, or USDC
3. Start trading!

### Provide Your Own Wallet

If you want to use your own wallet:

1. Export your private key from MetaMask/your wallet
2. Add to Railway Variables: `AGENT_WALLET_PRIVATE_KEY=0x...`
3. Redeploy

## Troubleshooting

### "Wallet Required" Error

**Problem**: Agent says wallet is required

**Solution**: 
- Wait for auto-generation (check logs after deployment)
- OR set `AGENT_WALLET_PRIVATE_KEY` in Railway Variables

### "Credentials Not Configured" Error

**Problem**: Agent says trading credentials are missing

**Solution**:
- Add the specific API key mentioned in the error message
- Follow platform-specific instructions above
- Restart/redeploy after adding variables

### Still Getting Generic Errors

**Problem**: Still seeing "ACP runtime" or generic errors

**Solution**:
1. Check that variables are actually set in Railway (not just local .env)
2. Verify the variable names match exactly
3. Ensure you redeployed after adding variables
4. Check agent logs in Railway for more details

## API Response Format

When credentials are missing, the API returns:

```typescript
{
  ok: false,
  error: string,                  // Short error description
  missingKeys: string[],          // List of required env vars
  setupInstructions: string,      // Detailed setup guide (markdown)
  helpUrl: string,                // Link to documentation
  platform: string                // Trading platform detected
}
```

## Frontend Integration

Frontend applications should handle the error response and display the `setupInstructions` to users:

```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    message: "Can you trade on Polymarket?"
  })
});

const data = await response.json();

if (!data.ok && data.setupInstructions) {
  // Display setup instructions to user
  console.log(data.setupInstructions);
  // Or show in UI as markdown
}
```

## Security Notes

- **Never commit API keys to git**
- **Use Railway Variables** for all secrets
- **API keys are platform-specific** - Polymarket keys won't work for Hyperliquid
- **Private keys give full control** - prefer API keys when available
- **Test with small amounts first**

## Additional Resources

- [Crypto Wallet Setup](CRYPTO-WALLET.md)
- [API Reference](API.md)
- [Railway Setup Guide](RAILWAY-SETUP.md)
- [Skill Installation](SKILL-INSTALLATION-GUIDE.md)

## Supported Trading Platforms

| Platform | Credentials Required | Auto-Detection |
|----------|---------------------|----------------|
| Polymarket | `POLYMARKET_API_KEY` or `POLYMARKET_PRIVATE_KEY` | ✅ Yes |
| Hyperliquid | `HYPERLIQUID_API_KEY` or `HYPERLIQUID_PRIVATE_KEY` | ✅ Yes |
| Uniswap/DeFi | `AGENT_WALLET_PRIVATE_KEY` (funded) | ✅ Yes |
| Other platforms | Check skill documentation | ⚠️ Partial |

---

## Quick Reference

**Polymarket:**
```bash
railway variables set POLYMARKET_API_KEY="your_key"
```

**Hyperliquid:**
```bash
railway variables set HYPERLIQUID_API_KEY="your_key"
```

**Custom Wallet:**
```bash
railway variables set AGENT_WALLET_PRIVATE_KEY="0x..."
```

After setting variables, Railway will automatically redeploy your agent.
