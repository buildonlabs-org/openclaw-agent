# Skill Requirements & Environment Variables

## Overview

When you ask your OpenClaw agent to use specific skills (like Polymarket, Twitter, Gmail, etc.), each skill may require specific environment variables to be configured. Instead of receiving a generic error like "ACP runtime configuration issue," the agent now provides **specific guidance** on which environment variables you need to set up in Railway.

## How It Works

1. **User sends request**: "Can you trade on Polymarket?" or "Post this to Twitter"
2. **Gateway detects skill**: Identifies which skill(s) the message is trying to use
3. **Validates requirements**: Checks if required environment variables are set
4. **Helpful error returned**: If missing, tells you exactly what to add
5. **Easy setup**: Follow the instructions to add variables in Railway

## Supported Skills & Requirements

### Trading & DeFi

<details>
<summary><strong>polymarket-odds</strong> - Polymarket prediction markets</summary>

**Required (any one):**
- `POLYMARKET_API_KEY` - Get from [polymarket.com/settings](https://polymarket.com/settings)
- `POLYMARKET_PRIVATE_KEY` - Your Polymarket wallet private key

**Get API Key:**
1. Go to polymarket.com/settings
2. Generate API key
3. Copy and add to Railway Variables

</details>

<details>
<summary><strong>hyperliquid-cli</strong> - Hyperliquid perpetual trading</summary>

**Required (any one):**
- `HYPERLIQUID_API_KEY` - Get from [hyperliquid.xyz/settings](https://hyperliquid.xyz/settings)
- `HYPERLIQUID_PRIVATE_KEY` - Your Hyperliquid wallet private key
- `AGENT_WALLET_PRIVATE_KEY` - Use agent's own wallet (fund it first)

</details>

<details>
<summary><strong>onchain</strong> - Blockchain operations (send, swap, etc.)</summary>

**Required:**
- `AGENT_WALLET_PRIVATE_KEY` - Funded crypto wallet

**Option 1: Use auto-generated wallet**
- Check `/api/wallet` for your agent's address
- Fund it with ETH/MATIC/USDC

**Option 2: Provide your own wallet**
- Add `AGENT_WALLET_PRIVATE_KEY=0x...` in Railway Variables

</details>

### Social Media

<details>
<summary><strong>twitter</strong> - Twitter/X posting and reading</summary>

**Required:**
- `TWITTER_API_KEY`
- `TWITTER_API_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_SECRET`

**Get credentials:** [developer.twitter.com](https://developer.twitter.com)

</details>

<details>
<summary><strong>telegram</strong> - Telegram bot integration</summary>

**Required:**
- `TELEGRAM_BOT_TOKEN`

**Get token:**
1. Message @BotFather on Telegram
2. Create a new bot with `/newbot`
3. Copy the token
4. Add to Railway Variables

</details>

<details>
<summary><strong>discord</strong> - Discord bot integration</summary>

**Required:**
- `DISCORD_BOT_TOKEN`

**Get token:**
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create application → Add Bot
3. Copy the token
4. Add to Railway Variables

</details>

### Email & Communication

<details>
<summary><strong>gmail</strong> - Gmail reading and sending</summary>

**Required:**
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

**Get credentials:** [console.cloud.google.com](https://console.cloud.google.com)

</details>

### Development

<details>
<summary><strong>github</strong> - GitHub operations (repos, PRs, issues)</summary>

**Required (any one):**
- `GITHUB_TOKEN`
- `GITHUB_PERSONAL_ACCESS_TOKEN`

**Get token:** [github.com/settings/tokens](https://github.com/settings/tokens)

</details>

### No Credentials Required

These skills work without any setup:
- `duckduckgo-search` - Web search
- `weather` - Weather forecasts
- And most read-only information skills

## Setting Up in Railway

### Step 1: Go to Variables Tab

1. Open your Railway project
2. Click on your service
3. Go to "Variables" tab

### Step 2: Add Required Variables

Click "New Variable" and add the required environment variables for your skill:

```
POLYMARKET_API_KEY = your_key_here
```

Or:

```
TWITTER_API_KEY = your_key_here
TWITTER_API_SECRET = your_secret_here
TWITTER_ACCESS_TOKEN = your_token_here
TWITTER_ACCESS_SECRET = your_secret_here
```

### Step 3: Redeploy (Automatic)

Railway automatically redeploys when you add/change variables.

### Step 4: Test

Try your command again:

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
  "error": "Skill requirements not configured",
  "skills": ["polymarket-odds"],
  "missingVars": ["POLYMARKET_API_KEY", "POLYMARKET_PRIVATE_KEY"],
  "setupInstructions": "⚠️ **Polymarket Skill Requires API Credentials**\n\nTo use Polymarket skill, add ONE of these in Railway Variables:\n- `POLYMARKET_API_KEY` - Get from polymarket.com/settings\n- `POLYMARKET_PRIVATE_KEY` - Your Polymarket wallet private key\n\n**Steps:**\n1. Go to Railway Variables tab\n2. Add the appropriate variable\n3. Service will automatically redeploy",
  "helpUrl": "https://github.com/buildonlabs-org/openclaw-agent#environment-variables"
}
```

### After Setup (Credentials Configured)

```json
{
  "ok": true,
  "response": "I can help you with Polymarket! What market are you interested in?",
  "agentId": "main",
  "sessionKey": "api-session-123456789"
}
```

## API Response Format

When requirements are missing, the API returns:

```typescript
{
  ok: false,
  error: string,                      // Short error description
  skills: string[],                   // Skills that triggered the check
  missingRequirements: Array<{        // Details for each skill
    skill: string,
    requiredVars: string[],
    missingVars: string[],
    anyOf: boolean,                   // If true, only one var needed
    setupInstructions: string
  }>,
  missingVars: string[],              // All unique missing variables
  setupInstructions: string,          // Combined setup guide (markdown)
  helpUrl: string                     // Link to documentation
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
    message: "Post this to Twitter: Hello World!"
  })
});

const data = await response.json();

if (!data.ok && data.setupInstructions) {
  // Display setup instructions to user
  console.log(data.setupInstructions);
  // Or show in UI as markdown
  showMarkdown(data.setupInstructions);
  
  // Show specific missing variables
  console.log('Missing:', data.missingVars);
  
  // Link to setup guide
  window.open(data.helpUrl);
}
```

## Troubleshooting

### "Skill requirements not configured" Error

**Problem**: Agent says skill requirements are missing

**Solution**:
1. Check the error response for `missingVars  `
2. Add those specific variables in Railway
3. Follow the `setupInstructions` provided
4. Wait for automatic redeploy

### Variables Not Taking Effect

**Problem**: Added variables but still getting errors

**Solution**:
1. Verify variables are set in Railway (not local .env)
2. Check variable names match exactly (case-sensitive)
3. Ensure redeploy completed successfully
4. Check Railway logs for startup errors

### Still Getting Generic Errors

**Problem**: Still seeing "ACP runtime" or other generic errors

**Solution**:
1. Check that you're using the latest version
2. Verify the skill is actually installed (`/api/skills`)
3. Check agent logs in Railway for more details
4. Some errors may be from the skill itself, not missing env vars

## Adding More Skills

To add a new skill with requirements, update `KNOWN_SKILL_REQUIREMENTS` in `src/server.js`:

```javascript
'your-skill-slug': {
  envVars: ['REQUIRED_VAR_1', 'REQUIRED_VAR_2'],
  anyOf: false, // Set true if only one variable is needed
  setupInstructions: [
    '⚠️ **Your Skill Requires Configuration**',
    '',
    'Add these variables in Railway:',
    '- `REQUIRED_VAR_1` - Description',
    '- `REQUIRED_VAR_2` - Description',
    ''
  ]
}
```

## Security Notes

- **Never commit API keys or tokens to git**
- **Use Railway Variables** for all secrets
- **API keys are service-specific** - Twitter keys won't work for GitHub
- **Tokens can be revoked** - keep them secure
- **Test with non-production accounts first**

## Additional Resources

- [API Reference](API.md)
- [Railway Setup Guide](RAILWAY-SETUP.md)
- [Skill Installation](SKILL-INSTALLATION-GUIDE.md)
- [Crypto Wallet Setup](CRYPTO-WALLET.md)

## Quick Reference

**Polymarket:**
```bash
railway variables set POLYMARKET_API_KEY="your_key"
```

**Twitter:**
```bash
railway variables set TWITTER_API_KEY="your_key"
railway variables set TWITTER_API_SECRET="your_secret"
railway variables set TWITTER_ACCESS_TOKEN="your_token"
railway variables set TWITTER_ACCESS_SECRET="your_secret"
```

**Telegram:**
```bash
railway variables set TELEGRAM_BOT_TOKEN="your_token"
```

**GitHub:**
```bash
railway variables set GITHUB_TOKEN="your_token"
```

**Custom Wallet:**
```bash
railway variables set AGENT_WALLET_PRIVATE_KEY="0x..."
```

After setting variables, Railway will automatically redeploy your agent.

---

## Supported Skills Matrix

| Skill | Environment Variables | Any/All | Auto-Detection |
|-------|----------------------|---------|----------------|
| polymarket-odds | `POLYMARKET_API_KEY` or `POLYMARKET_PRIVATE_KEY` | Any | ✅ |
| hyperliquid-cli | `HYPERLIQUID_API_KEY` or `HYPERLIQUID_PRIVATE_KEY` or `AGENT_WALLET_PRIVATE_KEY` | Any | ✅ |
| onchain | `AGENT_WALLET_PRIVATE_KEY` | All | ✅ |
| twitter | `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` | All | ✅ |
| telegram | `TELEGRAM_BOT_TOKEN` | All | ✅ |
| discord | `DISCORD_BOT_TOKEN` | All | ✅ |
| gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | All | ✅ |
| github | `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN` | Any | ✅ |
| duckduckgo-search | None | - | ✅ |

**Any** = Only one of the listed variables is required  
**All** = All listed variables are required
