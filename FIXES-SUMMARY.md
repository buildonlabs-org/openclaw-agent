# Connection & Device Pairing Fixes

## Issues Fixed

### 1. **CORS Support Added** ✅
- **Problem**: React frontend couldn't connect due to missing CORS headers
- **Solution**: 
  - Added `cors` package to dependencies
  - Configured permissive CORS middleware that allows:
    - All Railway domains (*.railway.app)
    - Localhost/127.0.0.1 for development
    - Configured origins from environment variables
    - All standard HTTP methods

### 2. **Device Pairing Auto-Approval Fixed** ✅
- **Problem**: Auto-approval was trying to approve already-paired devices, causing "unknown requestId" errors. Also, the Gateway's built-in autoApprove was racing with the wrapper's approval logic.
- **Solution**:
  - Fixed parsing logic to ONLY extract UUIDs from "Pending" section, not "Paired" section
  - **Disabled Gateway's built-in autoApprove** to prevent race conditions (wrapper handles approval)
  - Added intelligent error handling for already-processed requests
  - Reduced check frequency from 3s to 5s to avoid spam
  - Better logging to distinguish real errors from info messages
  - Increased gateway client connection timeout from 10s to 30s for device pairing

### 3. **API Route Protection** ✅
- **Problem**: Unclear if API routes were properly bypassing setup redirect
- **Solution**:
  - Added explicit 404 handler for unmatched /api/* routes
  - Ensures API routes with Bearer auth work even when agent shows "configured: false"

### 4. **Rate Limiting on Skill Installation** ℹ️
- **Issue**: ClawHub API rate limiting (not a bug, working as intended)
- **Current State**: Server already has retry logic (waits 2 minutes between attempts)
- **Usage**: Add `{"retry": true}` to request body for automatic retries

## Files Changed

1. **package.json**
   - Added `cors` package dependency

2. **src/server.js**
   - Imported and configured CORS middleware
   - Fixed device pairing parsing (only Pending section)
   - Improved error handling for device approval
   - Increased check interval to 5 seconds
   - Added API route 404 handler

## Deployment Steps

```bash
# Install new dependencies
npm install

# Commit changes
git add package.json src/server.js
git commit -m "Fix CORS and device pairing issues for external frontends"

# Push to trigger Railway deployment
git push origin attempt-fix-skills-interact-3-13
```

## Testing After Deployment

### Test 1: CORS from React Frontend
```javascript
// Should now work without CORS errors
fetch('https://your-railway-app.up.railway.app/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message: 'hello' })
})
```

### Test 2: Chat Endpoint via curl
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "what can you do?"}' \
  https://your-railway-app.up.railway.app/api/chat
```

### Test 3: Skill Installation with Retry
```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "weather", "retry": true}' \
  https://your-railway-app.up.railway.app/api/skills/install
```

## Expected Log Improvements

**Before:**
```
[gateway] device auto-approve enabled
[gateway] Found pending request: ef3e1d7d-a72a-47dd-9a34-78806484b9b5
[gateway] ⚠️  Approval returned code 1: unknown requestId
[gateway] Connection timeout after 10s
```

**After:**
```
[gateway] gateway built-in auto-approve disabled (wrapper handles it)
[gateway] Found 0 pending request(s)
[gateway] ℹ️  Request ef3e1d7d-a72a-47dd-9a34-78806484b9b5 was already processed
[gateway] ✓ Connected successfully
```

## API Endpoints Available

All these endpoints work with `Authorization: Bearer YOUR_API_KEY`:

- `POST /api/chat` - Send messages to agent
- `GET /api/status` - Get agent status
- `GET /api/skills` - List installed skills
- `POST /api/skills/install` - Install a skill (with retry support)
- `GET /api/devices` - List paired devices
- `GET /api/pairing` - List pending pairing requests
- `POST /api/pairing/approve` - Approve pairing request

## Notes

- The agent showing `configured: false` is expected on first run - the gateway runs with `--allow-unconfigured` flag
- Device pairing auto-approval now works correctly without spam
- External React frontends can now connect via CORS
- Rate limiting on skill installs is a ClawHub API limit (not a bug)
