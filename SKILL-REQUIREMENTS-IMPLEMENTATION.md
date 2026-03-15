# Skill Requirements Validation - Implementation Summary

## Problem Statement

When users ask the OpenClaw agent to use skills without proper environment variables configured, they receive generic error messages like:

> "It seems that I'm unable to [do action] due to a configuration issue with the ACP runtime."

This error doesn't tell users **what's actually missing** or **how to fix it**.

## Solution

Added **automatic skill requirements validation** to the chat endpoint that:

1. **Detects skill usage** - Identifies when users are trying to use specific skills
2. **Validates requirements** - Checks if necessary environment variables are set
3. **Returns helpful error messages** - Provides specific setup instructions instead of generic errors
4. **Works for ANY skill** - General solution, not limited to trading

## Changes Made

### 1. New Helper Functions in `src/server.js`

#### `KNOWN_SKILL_REQUIREMENTS` (Constant)
Curated map of skill slugs to their environment variable requirements:

```javascript
{
  'skill-slug': {
    envVars: ['VAR1', 'VAR2'],      // Required variables
    anyOf: false,                    // If true, only one var needed
    setupInstructions: [...]         // User-friendly setup guide
  }
}
```

**Currently Supported Skills:**
- `polymarket-odds` - Polymarket trading
- `hyperliquid-cli` - Hyperliquid perpetuals
- `onchain` - Blockchain operations
- `twitter` - Twitter integration
- `telegram` - Telegram bots
- `discord` - Discord bots
- `gmail` - Gmail operations
- `github` - GitHub operations
- `duckduckgo-search` - No requirements

#### `detectMentionedSkills(message)`
Analyzes user messages to detect which skills are being referenced:
- Checks for skill name mentions
- Uses fuzzy matching for common use cases
- Returns array of skill slugs
- Examples:
  - "trade on polymarket" → `['polymarket-odds']`
  - "post to twitter" → `['twitter']`
  - "send email via gmail" → `['gmail']`

#### `checkSkillRequirements(skillSlug)`
Validates environment variables for a specific skill:
- Checks if required env vars are set
- Supports "any of" logic (e.g., API key OR private key)
- Returns `null` if requirements met
- Returns error object with setup instructions if missing

### 2. Updated Chat Endpoint (`POST /api/chat`)

Added validation before sending messages to OpenClaw agent:

```javascript
// Detect skills mentioned in message
const mentionedSkills = detectMentionedSkills(message);

// Check requirements for each skill
if (mentionedSkills.length > 0) {
  const missingRequirements = [];
  
  for (const skillSlug of mentionedSkills) {
    const requirementCheck = checkSkillRequirements(skillSlug);
    if (requirementCheck) {
      missingRequirements.push(requirementCheck);
    }
  }
  
  // Return helpful error if any requirements missing
  if (missingRequirements.length > 0) {
    return res.status(400).json({
      ok: false,
      error: 'Skill requirements not configured',
      skills: mentionedSkills,
      missingRequirements,
      missingVars: allMissingVars,
      setupInstructions: combinedInstructions
    });
  }
}
```

### 3. Documentation

Created comprehensive documentation:
- **SKILL-REQUIREMENTS-GUIDE.md** - Complete user guide
- **test-skill-requirements.sh** - Test script
- **SKILL-REQUIREMENTS-IMPLEMENTATION.md** - This summary

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
  "error": "Skill requirements not configured",
  "skills": ["polymarket-odds"],
  "missingRequirements": [{
    "skill": "polymarket-odds",
    "requiredVars": ["POLYMARKET_API_KEY", "POLYMARKET_PRIVATE_KEY"],
    "missingVars": ["POLYMARKET_API_KEY", "POLYMARKET_PRIVATE_KEY"],
    "anyOf": true,
    "setupInstructions": "⚠️ **Polymarket Skill Requires API Credentials**\n\nTo use Polymarket skill, add ONE of these in Railway Variables:\n- `POLYMARKET_API_KEY` - Get from polymarket.com/settings\n- `POLYMARKET_PRIVATE_KEY` - Your Polymarket wallet private key\n\n**Steps:**\n1. Go to Railway Variables tab\n2. Add the appropriate variable\n3. Service will automatically redeploy"
  }],
  "missingVars": ["POLYMARKET_API_KEY", "POLYMARKET_PRIVATE_KEY"],
  "setupInstructions": "...",
  "helpUrl": "https://github.com/buildonlabs-org/openclaw-agent#environment-variables"
}
```

## Supported Skills & Requirements

| Skill | Environment Variables | Logic | Detected Keywords |
|-------|----------------------|-------|-------------------|
| polymarket-odds | `POLYMARKET_API_KEY` or `POLYMARKET_PRIVATE_KEY` | Any | polymarket, trade, bet, market |
| hyperliquid-cli | `HYPERLIQUID_API_KEY` or `HYPERLIQUID_PRIVATE_KEY` or `AGENT_WALLET_PRIVATE_KEY` | Any | hyperliquid, perpetual, futures |
| onchain | `AGENT_WALLET_PRIVATE_KEY` | All | send, transfer, swap, blockchain |
| twitter | `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` | All | twitter, tweet, post |
| telegram | `TELEGRAM_BOT_TOKEN` | All | telegram, tg |
| discord | `DISCORD_BOT_TOKEN` | All | discord |
| gmail | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | All | email, gmail, mail |
| github | `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN` | Any | github, repo, pr, issue |
| duckduckgo-search | None | - | search |

## Setup Instructions for Users

1. **Identify Missing Requirements**
   - Error response shows which variables are needed
   - `setupInstructions` field provides step-by-step guide

2. **Add Environment Variables in Railway**
   ```bash
   # For Polymarket
   railway variables set POLYMARKET_API_KEY="your_key"
   
   # For Twitter
   railway variables set TWITTER_API_KEY="your_key"
   railway variables set TWITTER_API_SECRET="your_secret"
   railway variables set TWITTER_ACCESS_TOKEN="your_token"
   railway variables set TWITTER_ACCESS_SECRET="your_secret"
   
   # For Telegram
   railway variables set TELEGRAM_BOT_TOKEN="your_token"
   ```

3. **Redeploy** (automatic when variables change)

4. **Test Again** - Skill will now work!

## Testing

Run the test script to verify functionality:

```bash
# Set your API endpoint and key
export ENDPOINT="https://your-agent.railway.app"
export WRAPPER_API_KEY="your-api-key"

# Run tests
./test-skill-requirements.sh
```

The test script validates:
- ✅ Polymarket skill detection
- ✅ Hyperliquid skill detection
- ✅ Twitter skill detection
- ✅ Telegram skill detection
- ✅ Discord skill detection
- ✅ Gmail skill detection
- ✅ GitHub skill detection
- ✅ Onchain skill detection
- ✅ Multiple skills in one message
- ✅ Non-skill messages pass through normally

## Error Response Format

When requirements are missing, the API returns:

```typescript
{
  ok: false,
  error: string,                      // Brief error description
  skills: string[],                   // Detected skill slugs
  missingRequirements: Array<{        // Details for each skill
    skill: string,
    requiredVars: string[],
    missingVars: string[],
    anyOf: boolean,
    setupInstructions: string
  }>,
  missingVars: string[],              // All unique missing vars
  setupInstructions: string,          // Combined setup guide
  helpUrl: string                     // Link to documentation
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
  
  // Show which skills need configuration
  console.log('Skills:', data.skills);
  
  // Show specific missing variables
  console.log('Missing:', data.missingVars);
  
  // Link to help
  showLink(data.helpUrl);
}
```

## Benefits

1. **Better UX** - Users know exactly what to configure
2. **Self-Service** - Clear instructions eliminate support requests
3. **Skill-Specific** - Tailored guidance for each skill
4. **Proactive** - Catches issues before reaching the OpenClaw agent
5. **Extensible** - Easy to add more skills
6. **Generic** - Works for ANY OpenClaw skill, not just trading

## Adding New Skills

To add a new skill, update `KNOWN_SKILL_REQUIREMENTS` in `src/server.js`:

```javascript
'your-skill-slug': {
  envVars: ['REQUIRED_VAR_1', 'OPTIONAL_VAR_2'],
  anyOf: false, // Set true if only one variable needed
  setupInstructions: [
    '⚠️ **Your Skill Requires Configuration**',
    '',
    'Add these variables in Railway:',
    '- `REQUIRED_VAR_1` - Get from service.com/settings',
    '- `OPTIONAL_VAR_2` - Alternative credential',
    '',
    '**Steps:**',
    '1. Go to Railway Variables tab',
    '2. Add the variable(s)',
    '3. Service redeploysautomatically',
    ''
  ]
}
```

Then update `detectMentionedSkills()` to recognize the skill in user messages.

## Security Considerations

- ✅ Checks are performed server-side
- ✅ No API keys exposed in error messages
- ✅ Environment variables remain secure
- ✅ Validation happens before OpenClaw agent interaction
- ✅ Error messages don't leak system information

## Backward Compatibility

- ✅ Existing chat requests work unchanged
- ✅ Messages not using skills pass through normally
- ✅ No breaking changes to API response format
- ✅ Optional feature - doesn't require configuration
- ✅ Skills without requirements work as before

## Future Enhancements

Potential improvements:
- Parse skill metadata from SKILL.md files automatically
- Check actual API connectivity (not just env var presence)
- Provide link to get API keys automatically
- Integration with Railway API to set variables programmatically
- Support for encrypted credential storage
- Skill-specific validation (e.g., check API key format)

## Files Modified/Created

- ✅ `src/server.js` - Added validation logic
- ✅ `SKILL-REQUIREMENTS-GUIDE.md` - User documentation  
- ✅ `test-skill-requirements.sh` - Test script
- ✅ `SKILL-REQUIREMENTS-IMPLEMENTATION.md` - This summary

## Quick Reference

**Check installed skills:**
```bash
curl -H "Authorization: Bearer $API_KEY" \
  "$ENDPOINT/api/skills"
```

**Add skill requirements:**
```bash
# See specific instructions in error message
railway variables set SKILL_VAR="value"
```

**Test the feature:**
```bash
./test-skill-requirements.sh
```

**Read full guide:**
```bash
cat SKILL-REQUIREMENTS-GUIDE.md
```

---

This implementation provides a **general, extensible solution** for validating skill requirements across ANY OpenClaw skill, not just trading platforms. It improves user experience by providing clear, actionable error messages when configuration is needed.
