# Frontend Guide: Update Telegram/Discord Without Reconfiguring

## Quick Start

When users want to change their Telegram or Discord bot token, they **don't need to reset and re-enter their LLM API key**. Use this endpoint instead:

### Endpoint: `POST /api/channels/update`

**Use Case:** Update messaging bot tokens without touching LLM configuration.

---

## Examples

### Update Telegram Token Only

```javascript
const response = await fetch('https://your-agent.railway.app/api/channels/update', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    telegram: {
      token: 'NEW_TELEGRAM_BOT_TOKEN'
    }
  })
});

const data = await response.json();
// { ok: true, message: "Channel configuration updated successfully" }
```

### Update Discord Token Only

```javascript
const response = await fetch('https://your-agent.railway.app/api/channels/update', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    discord: {
      token: 'NEW_DISCORD_BOT_TOKEN'
    }
  })
});
```

### Update Both Channels

```javascript
const response = await fetch('https://your-agent.railway.app/api/channels/update', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    telegram: {
      token: 'NEW_TELEGRAM_TOKEN',
      dmPolicy: 'pairing'  // Optional: 'pairing' or 'open'
    },
    discord: {
      token: 'NEW_DISCORD_TOKEN'
    }
  })
});
```

---

## Request Body Schema

```typescript
interface ChannelUpdateRequest {
  telegram?: {
    enabled?: boolean;       // Default: true
    token: string;           // Required: Bot token
    dmPolicy?: 'pairing' | 'open';  // Default: 'pairing'
    groupPolicy?: 'allowlist';      // Default: 'allowlist'
    streamMode?: 'partial';         // Default: 'partial'
  };
  discord?: {
    enabled?: boolean;       // Default: true
    token: string;           // Required: Bot token
    dmPolicy?: 'pairing' | 'open';  // Default: 'pairing'
    groupPolicy?: 'allowlist';      // Default: 'allowlist'
  };
}
```

---

## Response

**Success (200):**
```json
{
  "ok": true,
  "output": "Telegram config updated (exit=0)\n\nRestarting gateway...\nGateway restarted successfully\n",
  "message": "Channel configuration updated successfully"
}
```

**Error - Not Configured (400):**
```json
{
  "ok": false,
  "error": "Agent not configured yet",
  "hint": "Use POST /api/configure first to set up the agent"
}
```

**Error - No Updates (400):**
```json
{
  "ok": false,
  "error": "No channel updates provided",
  "hint": "Include 'telegram' or 'discord' in request body"
}
```

---

## UI Implementation

### Recommended Flow:

1. **Settings Page:** Show current channel status
   ```javascript
   const config = await fetch('/api/config/current', {
     headers: { 'Authorization': `Bearer ${apiKey}` }
   }).then(r => r.json());
   
   // config.config.telegram.hasToken === true (token is set)
   ```

2. **Update Button:** "Change Telegram Bot" / "Change Discord Bot"

3. **Simple Form:** Just ask for the new token
   ```html
   <input 
     type="text" 
     placeholder="Enter new Telegram bot token (e.g., 123456:ABC...)"
     value={newToken}
   />
   <button onClick={updateTelegramToken}>Update</button>
   ```

4. **Submit:** Call `/api/channels/update`
   ```javascript
   async function updateTelegramToken() {
     const response = await fetch('/api/channels/update', {
       method: 'POST',
       headers: {
         'Authorization': `Bearer ${apiKey}`,
         'Content-Type': 'application/json'
       },
       body: JSON.stringify({
         telegram: { token: newToken }
       })
     });
     
     if (response.ok) {
       showSuccess('Telegram bot updated! Gateway restarted.');
     }
   }
   ```

5. **Gateway Auto-Restarts:** Changes take effect immediately

---

## Key Benefits

- ✅ **No reset required** - LLM config stays intact
- ✅ **No re-entering API keys** - Only update what changed
- ✅ **Instant updates** - Gateway restarts automatically
- ✅ **Simple UX** - One field form instead of full reconfiguration

---

## When to Use This vs Full Reconfigure

| Scenario | Use This Endpoint | Use `/api/configure` |
|----------|-------------------|---------------------|
| Change Telegram token | ✅ Yes | ❌ No |
| Change Discord token | ✅ Yes | ❌ No |
| Add a new channel | ✅ Yes | ❌ No |
| Switch LLM provider | ❌ No | ✅ Yes |
| Change LLM model | ❌ No | ✅ Yes |
| Initial setup | ❌ No | ✅ Yes |

---

## Error Handling

```javascript
async function updateChannel(channelType, token) {
  try {
    const response = await fetch('/api/channels/update', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        [channelType]: { token }
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // Handle errors
      if (response.status === 400) {
        alert(data.error + '\n' + data.hint);
      } else {
        alert('Update failed: ' + data.error);
      }
      return;
    }
    
    // Success
    showToast('Channel updated successfully!');
    
  } catch (error) {
    console.error('Network error:', error);
    alert('Failed to connect to agent');
  }
}
```

---

## Testing

```bash
# Test update
curl -X POST http://localhost:8080/api/channels/update \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"telegram": {"token": "123456:ABC..."}}'

# Verify update
curl http://localhost:8080/api/config/current \
  -H "Authorization: Bearer YOUR_API_KEY"
```
