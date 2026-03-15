# Trading Credentials Validation - Implementation Summary

## Problem Statement

When users ask the OpenClaw agent to trade on platforms like Polymarket without proper API keys configured, they receive a generic error message:

> "It seems that I'm unable to initiate a trade on Polymarket due to a configuration issue with the ACP runtime."

This error doesn't tell users **what's actually missing** or **how to fix it**.

## Solution

Added **automatic credential validation** to the chat endpoint that:

1. **Detects trading requests** - Identifies when users ask about trading on specific platforms
2. **Validates required credentials** - Checks if necessary environment variables are set
3. **Returns helpful error messages** - Provides specific setup instructions instead of generic errors

## Changes Made

### 1. New Helper Functions in `src/server.js`

#### `detectTradingPlatform(message)`
Analyzes user messages to detect trading platform mentions:
- Returns `'polymarket'` for Polymarket requests
- Returns `'hyperliquid'` for Hyperliquid requests
- Returns `'defi'` for DeFi/Uniswap requests
- Returns `'trading'` for generic trading keywords
- Returns `null` for non-trading messages

#### `checkTradingCredentials(platform)`
Validates required credentials based on platform:
- Checks for `AGENT_WALLET_PRIVATE_KEY` (or auto-generated wallet)
- Checks for platform-specific API keys:
  - `POLYMARKET_API_KEY` or `POLYMARKET_PRIVATE_KEY`
  - `HYPERLIQUID_API_KEY` or `HYPERLIQUID_PRIVATE_KEY`
- Returns detailed error with setup instructions if credentials are missing
- Returns `null` if all credentials are present

### 2. Updated Chat Endpoint (`POST /api/chat`)

Added validation before sending messages to OpenClaw agent:

```javascript
// Check for trading requests and validate credentials
const tradingPlatform = detectTradingPlatform(message);
if (tradingPlatform) {
  const credentialCheck = checkTradingCredentials(tradingPlatform);
  if (credentialCheck) {
    return res.status(400).json({
      ok: false,
      error: credentialCheck.error,
      missingKeys: credentialCheck.missingKeys,
      setupInstructions: credentialCheck.message,
      helpUrl: credentialCheck.helpUrl,
      platform: tradingPlatform
    });
  }
}
```

### 3. Documentation

Created comprehensive documentation:
- **TRADING-CREDENTIALS-GUIDE.md** - Complete setup guide for users
- **test-trading-credentials.sh** - Test script to verify the feature

## Example: Before vs After

### Before (Generic Error)

**User:** "can you trade on polymarket"

**Response:**
```
"It seems that I'm unable to initiate a trade on Polymarket due to a configuration issue with the ACP runtime."
```

### After (Helpful Error)

**User:** "can you trade on polymarket"

**Response:**
```json
{
  "ok": false,
  "error": "Trading credentials not configured",
  "missingKeys": ["POLYMARKET_API_KEY or POLYMARKET_PRIVATE_KEY"],
  "setupInstructions": "⚠️ **Polymarket Credentials Required**\n\nTo trade on Polymarket, add one of these in Railway Variables:\n- `POLYMARKET_API_KEY` (preferred) - Get from polymarket.com/settings\n- OR `POLYMARKET_PRIVATE_KEY` - Your Polymarket wallet private key\n\n⚠️ **Wallet Required**: Your agent needs a crypto wallet to trade.\n\n**Option 1: Wait for auto-generation**\n- The agent will auto-generate a wallet on startup\n- Check logs or visit /api/wallet to get the address\n- Fund the wallet with ETH/MATIC/USDC\n\n**Option 2: Set your own wallet**\n1. In Railway, go to Variables tab\n2. Add: `AGENT_WALLET_PRIVATE_KEY=0x...`\n3. Redeploy the service",
  "helpUrl": "https://github.com/buildonlabs-org/openclaw-agent#crypto-wallet",
  "platform": "polymarket"
}
```

## Supported Platforms

| Platform | Environment Variables |
|----------|----------------------|
| Polymarket | `POLYMARKET_API_KEY` or `POLYMARKET_PRIVATE_KEY` |
| Hyperliquid | `HYPERLIQUID_API_KEY` or `HYPERLIQUID_PRIVATE_KEY` |
| DeFi/Uniswap | `AGENT_WALLET_PRIVATE_KEY` (funded wallet) |

## Setup Instructions for Users

1. **Go to Railway Variables**
   - Open your Railway project
   - Click on your service
   - Go to "Variables" tab

2. **Add Required Credentials**
   ```bash
   # For Polymarket
   POLYMARKET_API_KEY=your_key_here
   
   # For Hyperliquid
   HYPERLIQUID_API_KEY=your_key_here
   
   # For custom wallet
   AGENT_WALLET_PRIVATE_KEY=0x...
   ```

3. **Redeploy** (automatic when variables change)

4. **Test Again** - Trading requests will now work!

## Testing

Run the test script to verify functionality:

```bash
# Set your API endpoint and key
export ENDPOINT="https://your-agent.railway.app"
export WRAPPER_API_KEY="your-api-key"

# Run tests
./test-trading-credentials.sh
```

The test script validates:
- ✅ Polymarket request detection
- ✅ Hyperliquid request detection
- ✅ Generic trading keyword detection
- ✅ DeFi trading detection
- ✅ Non-trading messages pass through normally

## Error Response Format

When credentials are missing, the API returns:

```typescript
{
  ok: false,
  error: string,                  // Brief error description
  missingKeys: string[],          // List of required environment variables
  setupInstructions: string,      // Detailed markdown instructions
  helpUrl: string,                // Link to documentation
  platform: string                // Detected trading platform
}
```

## Frontend Integration

Frontend applications should detect and display the helpful error:

```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: "trade on polymarket" })
});

const data = await response.json();

if (!data.ok && data.setupInstructions) {
  // Display setup instructions to user
  showMarkdown(data.setupInstructions);
  showLink(data.helpUrl);
}
```

## Benefits

1. **Better UX** - Users know exactly what to configure
2. **Self-Service** - Clear instructions eliminate support requests
3. **Platform-Specific** - Tailored guidance for each trading platform
4. **Proactive** - Catches issues before reaching the OpenClaw agent
5. **Extensible** - Easy to add more platforms

## Future Enhancements

Potential improvements:
- Add more trading platforms (DEX aggregators, CEXs, etc.)
- Check wallet balance and warn if insufficient funds
- Validate API keys format before accepting
- Integration with Railway API to set variables automatically
- Support for multiple wallet addresses per platform

## Files Modified

- ✅ `src/server.js` - Added validation logic
- ✅ `TRADING-CREDENTIALS-GUIDE.md` - User documentation
- ✅ `test-trading-credentials.sh` - Test script
- ✅ `TRADING-CREDENTIALS-IMPLEMENTATION.md` - This summary

## Security Considerations

- ✅ Checks are performed server-side
- ✅ No API keys exposed in error messages
- ✅ Environment variables remain secure
- ✅ Validation happens before OpenClaw agent interaction
- ✅ Error messages don't leak system information

## Backward Compatibility

- ✅ Existing chat requests work unchanged
- ✅ Non-trading messages pass through normally
- ✅ No breaking changes to API response format
- ✅ Optional feature - doesn't require configuration

---

## Quick Reference

**Add Polymarket credentials:**
```bash
railway variables set POLYMARKET_API_KEY="your_key"
```

**Add Hyperliquid credentials:**
```bash
railway variables set HYPERLIQUID_API_KEY="your_key"  
```

**Add custom wallet:**
```bash
railway variables set AGENT_WALLET_PRIVATE_KEY="0x..."
```

**Test the feature:**
```bash
./test-trading-credentials.sh
```

**Read full guide:**
```bash
cat TRADING-CREDENTIALS-GUIDE.md
```
