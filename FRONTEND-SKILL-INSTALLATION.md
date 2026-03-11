# Frontend Guide: Skill Installation

## Overview

This guide explains how to enable skill installation in your frontend application after the device pairing fix has been deployed.

## One-Time Setup (Required After First Deploy)

After deploying the updated backend code, you must approve the internal device **once**. This approval persists across all future restarts.

```javascript
async function approveInternalDevice(apiUrl, apiKey) {
  try {
    // Get pending devices
    const response = await fetch(`${apiUrl}/api/devices`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const { devices } = await response.json();
    
    // Approve the first pending device (internal gateway client)
    if (devices.length > 0) {
      await fetch(`${apiUrl}/api/devices/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          requestId: devices[0].requestId 
        })
      });
      
      console.log('✅ Device approved successfully');
      return true;
    }
    
    console.log('ℹ️ No pending devices to approve');
    return false;
    
  } catch (error) {
    console.error('❌ Device approval failed:', error);
    return false;
  }
}

// Call this once after deploying the new backend
await approveInternalDevice(
  'https://your-agent.railway.app',
  'your-api-key'
);
```

## Skill Installation Flow

### Step 1: Search for Skills (Optional)

```javascript
async function searchSkills(query, apiUrl, apiKey) {
  const response = await fetch(
    `${apiUrl}/api/skills/search?q=${encodeURIComponent(query)}&limit=10`,
    {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }
  );
  
  const data = await response.json();
  return data.results;
  // Returns: [{ slug, name, description, author, version, score }, ...]
}

// Example usage
const skills = await searchSkills('hyperliquid', apiUrl, apiKey);
console.log(skills[0]); 
// { slug: 'hyperliquid-cli', name: 'hyperliquid-cli', description: '...' }
```

### Step 2: Install Skill via Chat

```javascript
async function installSkill(skillSlug, userId, apiUrl, apiKey) {
  // Install the skill via conversational chat
  const response = await fetch(`${apiUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `install the ${skillSlug} skill`,
      sessionKey: `user-${userId}`
    })
  });
  
  const data = await response.json();
  
  if (data.ok) {
    return {
      success: true,
      message: data.response // Agent's confirmation message
    };
  }
  
  return {
    success: false,
    error: data.response
  };
}

// Example usage
const result = await installSkill(
  'hyperliquid-cli',
  'user-123',
  apiUrl,
  apiKey
);

console.log(result.message);
// "The hyperliquid-cli skill has been successfully installed..."
```

### Step 3: Restart Gateway (For Immediate Use)

Skills are loaded when the gateway starts. To make the skill available immediately after installation:

```javascript
async function restartGateway(apiUrl, apiKey) {
  await fetch(`${apiUrl}/api/doctor`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  
  // Wait for gateway to restart and reload skills (8-10 seconds)
  await new Promise(resolve => setTimeout(resolve, 8000));
}

// Example usage
await restartGateway(apiUrl, apiKey);
console.log('✅ Gateway restarted, skills loaded');
```

### Complete Installation Function

```javascript
async function installSkillComplete(skillSlug, userId, apiUrl, apiKey) {
  try {
    // 1. Install skill
    const installResult = await installSkill(skillSlug, userId, apiUrl, apiKey);
    
    if (!installResult.success) {
      return {
        success: false,
        error: installResult.error
      };
    }
    
    // 2. Restart gateway to load skill immediately
    await restartGateway(apiUrl, apiKey);
    
    // 3. Verify skill is loaded (optional)
    const verifyResponse = await fetch(`${apiUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `what ${skillSlug} commands can you run?`,
        sessionKey: `user-${userId}`
      })
    });
    
    const verifyData = await verifyResponse.json();
    
    return {
      success: true,
      installMessage: installResult.message,
      skillsAvailable: verifyData.response
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
```

## Alternative: Direct API Installation

If you prefer more control over the installation process:

```javascript
async function installSkillDirect(skillSlug, apiUrl, apiKey) {
  const response = await fetch(`${apiUrl}/api/skills/install`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      slug: skillSlug,
      retry: true  // Auto-retry on rate limits (exponential backoff)
    })
  });
  
  const data = await response.json();
  
  return {
    success: data.ok,
    output: data.output,
    exitCode: data.exitCode,
    attempts: data.attempts
  };
}
```

## List Installed Skills

```javascript
async function listInstalledSkills(apiUrl, apiKey) {
  const response = await fetch(`${apiUrl}/api/skills`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  
  const data = await response.json();
  return data.skills;
  // Returns: [{ slug, version, raw }, ...]
}
```

## React Example Component

```jsx
import { useState } from 'react';

function SkillInstaller({ apiUrl, apiKey, userId }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState('');

  const handleSearch = async () => {
    const skills = await searchSkills(query, apiUrl, apiKey);
    setResults(skills);
  };

  const handleInstall = async (skillSlug) => {
    setInstalling(true);
    setMessage('Installing...');
    
    const result = await installSkillComplete(skillSlug, userId, apiUrl, apiKey);
    
    if (result.success) {
      setMessage(`✅ ${skillSlug} installed and ready to use!`);
    } else {
      setMessage(`❌ Installation failed: ${result.error}`);
    }
    
    setInstalling(false);
  };

  return (
    <div>
      <input 
        value={query} 
        onChange={e => setQuery(e.target.value)}
        placeholder="Search skills..."
      />
      <button onClick={handleSearch}>Search</button>
      
      <ul>
        {results.map(skill => (
          <li key={skill.slug}>
            <strong>{skill.name}</strong>
            <p>{skill.description}</p>
            <button 
              onClick={() => handleInstall(skill.slug)}
              disabled={installing}
            >
              Install
            </button>
          </li>
        ))}
      </ul>
      
      {message && <div>{message}</div>}
    </div>
  );
}
```

## Important Notes

### Rate Limits
- ClawHub has rate limits on skill downloads
- Wait 1-2 minutes between installations OR use `retry: true` for automatic retries
- Search is unlimited (doesn't hit rate limits)

### Device Approval
- Only required **once** after deploying the new backend code
- Approval persists in `/data/.openclaw/gateway-client-device.json`
- Survives all restarts and redeployments (as long as `/data` volume persists)

### Gateway Restart
- **Required** if you want skills available immediately after installation
- Takes 8-10 seconds to complete
- Without restart, skills load on next natural restart (redeployment, crash recovery, etc.)

### Error Handling
- Check for "pairing required" error → device needs approval (one-time)
- Check for "rate limit" error → wait 1-2 minutes or retry
- Check for "already installed" → skill is already present, restart gateway to load

## Troubleshooting

### Device Pairing Still Required
```bash
# Check pending devices
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/devices

# Approve specific device
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "DEVICE_REQUEST_ID"}' \
  https://your-agent.railway.app/api/devices/approve
```

### Skill Installed But Not Working
- Restart the gateway: `POST /api/doctor`
- Wait 8-10 seconds
- Try using the skill again

### Installation Says Success But Skill Not Listed
- This is expected - `clawhub list` parsing has a bug
- Check the filesystem: skill exists in `/data/workspace/skills/`
- Restart gateway and try using the skill - it will work

## Summary Checklist

- [ ] Deploy updated backend code with device pairing fix
- [ ] Call `approveInternalDevice()` once after deployment
- [ ] Implement `searchSkills()` for skill discovery
- [ ] Implement `installSkill()` for installation via chat
- [ ] Call `restartGateway()` after installation for immediate use
- [ ] Handle rate limits with retry logic or delays
- [ ] Show user-friendly messages during installation

## API Endpoints Reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/devices` | GET | List pending device approvals |
| `/api/devices/approve` | POST | Approve a device (one-time) |
| `/api/skills/search` | GET | Search ClawHub for skills |
| `/api/skills/install` | POST | Install skill (direct API) |
| `/api/skills` | GET | List installed skills |
| `/api/chat` | POST | Install via conversational chat |
| `/api/doctor` | POST | Restart gateway |
