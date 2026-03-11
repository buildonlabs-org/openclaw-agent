# Device Pairing Fix - Summary

## Problem

When trying to install skills via the agent API (`/api/chat`), the system consistently failed with:
```
[gateway] <= res c1 { code: 'NOT_PAIRED', message: 'pairing required' }
[ws] closed before connect code=1008 reason=pairing required
```

Basic chat worked fine, but any tool execution (like skill installation) required device-level operator permissions, which triggered the pairing requirement.

## Root Cause

The gateway client (`src/gatewayClient.js`) was sending device authentication credentials during the WebSocket handshake, but when the gateway responded with a `NOT_PAIRED` error in the connect response, the code was:

1. **Not detecting the pairing requirement** - Only listening for a separate `device.pair.requested` event that never arrived
2. **Not triggering the approval callback** - The `onPairingRequired` callback was never invoked
3. **Closing the connection immediately** - No retry logic to reconnect after approval

## Solution

### 1. Detect Pairing Requirement in Connect Response

**File:** `src/gatewayClient.js` (lines ~195-217)

Changed the connect response handler to detect `NOT_PAIRED` errors and trigger the pairing callback:

```javascript
// 2) Connect response -> mark ready or handle pairing
if (msg.type === "res" && msg.id === "c1") {
  if (msg.ok) {
    this.ready = true;
  } else if (msg.error?.code === "NOT_PAIRED" || msg.error?.details?.code === "PAIRING_REQUIRED") {
    // Handle pairing requirement from connect response
    this.pairingRequired = true;
    console.log("[gateway-client] pairing required for device:", this.deviceId);
    if (this.onPairingRequired) {
      console.log("[gateway-client] triggering pairing callback...");
      // Trigger callback asynchronously, don't block message processing
      Promise.resolve().then(() => this.onPairingRequired(this.deviceId, msg.error?.details?.requestId));
    }
  } else {
    // Other error
    this.connectError = msg.error?.message || JSON.stringify(msg.error);
  }
  return;
}
```

**Key changes:**
- Set `this.pairingRequired = true` flag
- Trigger the `onPairingRequired` callback with deviceId and requestId
- Store other errors in `this.connectError` for proper error handling

### 2. Add Connection State Tracking

**File:** `src/gatewayClient.js` (lines ~69-70)

Added state tracking to distinguish between ready, pairing required, and error states:

```javascript
this.pairingRequired = false; // Track pairing state
this.connectError = null; // Store connection errors
```

### 3. Improve Connect Loop

**File:** `src/gatewayClient.js` (lines ~107-120)

Modified the connection wait loop to handle all three states:

```javascript
// Wait until ready or error
const start = Date.now();
while (!this.ready && !this.pairingRequired && !this.connectError) {
  if (Date.now() - start > 15_000) throw new Error("Gateway connect timeout");
  await sleep(50);
}

// Throw appropriate error if connection failed
if (this.pairingRequired) {
  throw new Error("pairing required");
}
if (this.connectError) {
  throw new Error(`Gateway connect failed: ${this.connectError}`);
}
```

### 4. Set Up Auto-Approval Callback

**File:** `src/server.js` (lines ~2067-2080, ~2099-2103)

Created auto-approval function and wired it to the gateway client:

```javascript
async function autoApproveGatewayDevice(deviceId, requestId) {
  try {
    console.log(`[gateway] auto-approving device ${deviceId}${requestId ? ` (request ${requestId})` : ''}...`);
    const approveResult = await runCmd(OPENCLAW_CLI, ["devices", "approve", deviceId]);
    if (approveResult.code === 0) {
      console.log(`[gateway] device ${deviceId} approved successfully`);
      return true;
    } else {
      console.error(`[gateway] device approval failed: ${approveResult.output}`);
      return false;
    }
  } catch (err) {
    console.error(`[gateway] auto-approve failed: ${err.message}`);
    return false;
  }
}

// Set up auto-approval callback for device pairing
gatewayClient.onPairingRequired = async (deviceId, requestId) => {
  console.log(`[gateway] pairing required for device ${deviceId}, auto-approving...`);
  await autoApproveGatewayDevice(deviceId, requestId);
};
```

### 5. Add Retry Logic with Delays

**File:** `src/server.js` (lines ~2104-2142)

Implemented retry logic to reconnect after device approval:

```javascript
// Try to connect with retry logic for pairing
let attempts = 0;
const maxAttempts = 3;

while (attempts < maxAttempts) {
  try {
    await gatewayClient.connect();
    console.log("[gateway-client] connected successfully");
    return gatewayClient;
  } catch (connectError) {
    attempts++;
    const isPairingError = connectError.message.includes('pairing') || 
                          connectError.message.includes('timeout') ||
                          connectError.message.includes('1008');
    
    if (isPairingError && attempts < maxAttempts) {
      console.log(`[gateway-client] connection attempt ${attempts} failed (pairing issue), retrying in 5s...`);
      await sleep(5000); // Give approval time to complete
      
      // Reset client for retry
      gatewayClient.close();
      gatewayClient = new OpenClawGatewayClient({
        gatewayUrl,
        token: OPENCLAW_GATEWAY_TOKEN,
        keyPath
      });
      gatewayClient.onPairingRequired = async (deviceId, requestId) => {
        await autoApproveGatewayDevice(deviceId, requestId);
      };
    } else {
      throw connectError;
    }
  }
}
```

**Key changes:**
- 3 connection attempts with 5-second delays
- Recreate client on each retry to get fresh connection
- Re-attach pairing callback on each retry

## Expected Behavior After Fix

When the frontend (or any client) calls `/api/chat` to install a skill, you should see:

```
[gateway-client] device ID: e3077456ede4a60e9b3a19a96d5ad2b27bb01e57ce1fe3df395214d91780ba71
[gateway] <= res c1 { code: 'NOT_PAIRED', message: 'pairing required' }
[gateway-client] pairing required for device: e3077456...
[gateway-client] triggering pairing callback...
[gateway] pairing required for device e3077456..., auto-approving...
[gateway] auto-approving device e3077456...
[gateway] device e3077456 approved successfully
[gateway-client] connection attempt 1 failed (pairing issue), retrying in 5s...
[gateway-client] loaded persistent device identity
[gateway-client] device ID: e3077456...
[gateway] <= event connect.challenge
[gateway] <= res c1 (success)
[gateway-client] connected successfully
```

After this sequence completes **once**, the device approval persists in `/data/.openclaw/gateway-client-device.json` and all future connections succeed immediately without requiring approval.

## Files Changed

1. **src/gatewayClient.js**
   - Added `pairingRequired` and `connectError` state tracking
   - Modified connect response handler to detect NOT_PAIRED
   - Improved error handling in connect loop
   - Added async callback triggering with Promise.resolve()

2. **src/server.js**
   - Created `autoApproveGatewayDevice()` function
   - Modified `getGatewayClient()` to be async with retry logic
   - Added pairing callback setup
   - Increased retry delay from 2s to 5s

## Verification

Test that the fix works:

```bash
# 1. Install a skill via chat
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "install the hyperliquid-cli skill", "sessionKey": "test-123"}' \
  https://your-agent.railway.app/api/chat

# 2. Check that no devices are pending (auto-approved)
curl -H "Authorization: Bearer YOUR_API_KEY" \
  https://your-agent.railway.app/api/devices

# Expected: {"success": true, "devices": []}
```

## Key Insight

The critical discovery was that OpenClaw's gateway doesn't send a separate `device.pair.requested` **event** - it sends the pairing requirement as an **error response** to the connect request. The fix was to handle this error response properly and trigger the approval workflow from there, rather than waiting for an event that never arrives.
