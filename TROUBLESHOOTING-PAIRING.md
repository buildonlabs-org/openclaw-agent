# Telegram Pairing Troubleshooting Guide

## ⚠️ IMPORTANT: Check if Pairing Actually Worked!

**Before troubleshooting:** Even if the UI shows "Pairing Failed", the pairing might have actually succeeded! 

**Quick Test:**
1. Have the user send a message to the bot
2. If the bot responds, pairing worked (ignore the error message)
3. If the bot doesn't respond, continue troubleshooting below

The UI has been improved to better detect success, but older versions may show false failures.

---

## Error: "No pending pairing request found for code: XXXXXXXX"

This error occurs when you try to approve a pairing code that doesn't exist in the OpenClaw system. Here's how to fix it:

### Quick Fix Steps:

#### 1. **Check Gateway Status**
The gateway MUST be running for pairing to work.

**In Railway logs, look for:**
```
[gateway] listening on ws://127.0.0.1:18789
[telegram] [default] starting provider (@yourbot)
```

**❌ Bad signs:**
```
[gateway] failed to become ready after 20000ms
```

If you see "failed to become ready", the gateway isn't starting properly. Check:
- Is your API key valid?
- Is the configuration file intact?
- Are there any error messages before this?

#### 2. **Verify Pairing Code is Active**

Pairing codes **expire quickly** (typically 5-10 minutes). If the code is old:

**Solution:** Have the user get a fresh code:
1. User sends `/start` or any message to your bot
2. Bot replies with a NEW pairing code
3. Immediately approve it (don't wait!)

#### 3. **Check for Pending Requests**

**Using the updated UI (recommended):**
1. Go to `/setup` in your browser
2. Click "Approve Pairing"
3. The modal now shows all pending pairing requests at the top
4. Look for your code in the list

**Using API directly:**
```bash
curl -u ":$SETUP_PASSWORD" \
  "https://your-app.railway.app/setup/api/pairing/list?channel=telegram"
```

#### 4. **Common Causes & Solutions**

| Problem | Cause | Solution |
|---------|-------|----------|
| Code expired | Waited too long | Get fresh code and approve within 2-3 minutes |
| Gateway not ready | Startup failure | Check logs for errors, restart if needed |
| Wrong code | Typo or wrong user | Double-check the exact code from Telegram |
| Already approved | Code was used | Have user send new message for new code |

### Step-by-Step Pairing Workflow:

**The correct timing is critical:**

```
USER ACTION                          ADMIN ACTION                    TIMING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. User sends /start to bot                                         T+0s
   └─> Bot replies: "Code: D3DBSP5B"

2.                                   Admin gets code from user       T+30s

3.                                   Admin opens /setup → Pairing    T+45s

4.                                   Admin enters code & approves    T+60s
                                     ✓ Success!

   User sends message again
   └─> Bot responds normally!                                       T+90s
```

**❌ Wrong workflow (code expires):**
```
T+0s:   User gets code D3DBSP5B
T+15m:  Admin tries to approve ← TOO LATE! Code expired
        Error: "No pending pairing request found"
```

### Advanced Diagnostics:

#### Check OpenClaw CLI directly (if you have shell access):

```bash
# List all pending pairing requests
openclaw pairing list

# List for specific channel
openclaw pairing list telegram

# Try to approve
openclaw pairing approve telegram D3DBSP5B
```

#### Check configuration:

```bash
# View Telegram configuration
openclaw config show | grep -A 10 "telegram"

# Should show:
#   channels:
#     telegram:
#       enabled: true
#       dmPolicy: pairing
#       botToken: "YOUR_TOKEN"
```

### Fix: Gateway Not Starting

If the gateway fails to start, this is the root cause:

#### Check logs for these errors:

**Error: "Invalid API key"**
```
Solution: Reset setup and enter correct API key
```

**Error: "Model not found"**
```
Solution: Check model name, use default if unsure
```

**Error: "Config file corrupted"**
```
Solution: Reset setup to recreate configuration
```

#### Quick Reset:
1. Go to `/setup`
2. Click "Reset Setup" (red button)
3. Re-run the setup wizard
4. Test Telegram again

### Prevent Future Issues:

1. **Set up monitoring:**
   - Check `/setup` regularly to see gateway status
   - Look for "Gateway: Running ✓" indicator

2. **Educate users:**
   - Tell them to wait for pairing approval
   - Give them a time window (e.g., "send code, wait 2 minutes")
   - Let them know if approval takes longer than expected

3. **Quick approval process:**
   - Keep `/setup` open in a browser tab
   - When user requests access, approve immediately
   - Don't let codes sit for more than 5 minutes

### Still Having Issues?

If none of the above works:

1. **Capture full logs:**
   - Railway logs from startup
   - Error message with full stack trace
   - Output of `/setup/api/debug`

2. **Check OpenClaw version:**
   ```bash
   openclaw --version
   ```
   Make sure you're on the latest version (v2026.2.23 or newer)

3. **Verify bot configuration:**
   - Bot token is valid (test with Telegram API)
   - Bot is not blocked
   - Bot has correct permissions

### Reference: What the Code Does

When you click "Approve Pairing" in the UI:

```javascript
// Frontend sends request
POST /setup/api/pairing/approve
{
  "channel": "telegram",
  "code": "D3DBSP5B"
}

// Backend runs OpenClaw CLI
$ openclaw pairing approve telegram D3DBSP5B

// Success response
{ "ok": true, "output": "Approved pairing for user..." }

// Error response (no pending request)
{ 
  "ok": false, 
  "output": "Error: No pending pairing request found for code: D3DBSP5B"
}
```

The error means OpenClaw's pairing system has no record of that code. This is almost always due to:
- Code expiration (most common)
- Gateway not running (second most common)
- Typo in the code
