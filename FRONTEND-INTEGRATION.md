# Frontend Integration Guide

## What Changed

Skills installation is now done via **API endpoints** instead of chat messages. This provides:
- ✅ Reliable installation with actual command output
- ✅ Automatic retry logic for rate limits (2-minute waits)
- ✅ Manual restart control to load skills
- ✅ No device pairing required

## New Workflow

### 1. Install Skills
Use `POST /api/skills/install` instead of sending chat messages.

```javascript
// ❌ OLD: Don't do this
await sendChatMessage("Install the hyperliquid skill");

// ✅ NEW: Do this
const response = await fetch(`${agentUrl}/api/skills/install`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    slug: 'hyperliquid',
    retry: true  // Enables automatic 2-minute retry on rate limits
  })
});

const result = await response.json();
if (result.ok) {
  console.log(`✓ Installed ${result.slug}`);
} else {
  console.error(`✗ Failed: ${result.error}`);
}
```

### 2. Restart Agent
After installing skills, call `POST /api/admin/restart` to load them.

```javascript
// Restart to load newly installed skills
await fetch(`${agentUrl}/api/admin/restart`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` }
});

// Wait 10 seconds for restart to complete
await new Promise(resolve => setTimeout(resolve, 10000));
```

### 3. Verify Installation (Optional)
Check installed skills with `GET /api/skills`.

```javascript
const response = await fetch(`${agentUrl}/api/skills`, {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});

const { skills } = await response.json();
console.log('Installed skills:', skills.map(s => s.slug));
```

## Complete Example

```javascript
async function setupAgentSkills(agentUrl, apiKey, skillsToInstall) {
  try {
    // Install each skill
    for (const skill of skillsToInstall) {
      const response = await fetch(`${agentUrl}/api/skills/install`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ slug: skill, retry: true })
      });
      
      const result = await response.json();
      if (!result.ok) {
        throw new Error(`Failed to install ${skill}: ${result.error}`);
      }
      
      // Small delay between installations
      await new Promise(r => setTimeout(r, 5000));
    }
    
    // Restart agent to load skills
    await fetch(`${agentUrl}/api/admin/restart`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    
    // Wait for restart
    await new Promise(r => setTimeout(r, 10000));
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Usage
await setupAgentSkills(
  'https://agent.railway.app',
  'your-api-key',
  ['hyperliquid', 'twitter', 'postiz']
);
```

## API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/skills/install` | POST | Install a skill |
| `/api/skills` | GET | List installed skills |
| `/api/skills/search?q=query` | GET | Search available skills |
| `/api/admin/restart` | POST | Restart agent to load skills |

## Rate Limiting

- With `"retry": true`, the API automatically waits 2 minutes between retry attempts
- Without retry, you'll get HTTP 429 if rate limited
- Recommendation: Always use `"retry": true` for installations

## Error Handling

```javascript
const response = await fetch(`${agentUrl}/api/skills/install`, {
  method: 'POST',
  headers: { /* ... */ },
  body: JSON.stringify({ slug: 'skillname', retry: true })
});

const result = await response.json();

if (response.status === 429) {
  // Rate limited - should not happen with retry:true
  console.error('Rate limited:', result.suggestion);
} else if (!result.ok) {
  // Other error
  console.error('Installation failed:', result.error);
  console.log('Output:', result.output);
}
```

## No Device Pairing Required

Device pairing is **NOT needed** for API-based skill installation. The wrapper handles device identity automatically.

Pairing is only needed if users access the agent via:
- Telegram/Discord DMs
- Gateway control UI

For programmatic skill installation via API, no pairing workflow is required.
