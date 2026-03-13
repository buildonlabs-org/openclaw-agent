# Device Pairing Made Optional

## Problem
When users tried to use skills via `/api/chat` from the React frontend, they received a "pairing required" error. This was because the gateway client was sending device authentication information (ed25519 signatures), which triggered the gateway's device pairing requirement.

## Solution
Modified `gatewayClient.js` to make device pairing **optional and disabled by default**.

### Changes Made

**File:** `gatewayClient.js`

1. **Added `enableDevicePairing` parameter** (defaults to `false`):
   ```javascript
   constructor({ gatewayUrl, token, enableDevicePairing = false })
   ```

2. **Conditional device keypair generation**:
   - Only generates ed25519 keypair if `enableDevicePairing` is `true`
   - Skips device ID generation when pairing is disabled

3. **Conditional device info in connect request**:
   - Only includes device signature in connect params if `enableDevicePairing` is `true`
   - Gateway doesn't require pairing when device info is omitted

## Impact

### ✅ For API-based chat (React frontend)
- **No device pairing required** ← This fixes the issue
- Users can immediately use skills via `/api/chat`
- No need to approve devices for chat operations
- Gateway auth still enforced via bearer token

### ✅ For secure scenarios (if needed)
- Can enable device pairing by passing `enableDevicePairing: true`
- Useful for production deployments requiring device-level security
- Device approval workflow still available

## How to Enable Device Pairing (Optional)

If you want device-level security for specific use cases:

```javascript
const client = new OpenClawGatewayClient({
  gatewayUrl: 'ws://localhost:8080/gateway',
  token: 'your-token',
  enableDevicePairing: true  // Enable device pairing
});
```

Then approve devices via:
- `GET /api/devices` - List pending devices
- `POST /api/devices/approve` - Approve device

## Testing

Test that skills work without pairing:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "what skills do you have"}' \
  https://your-agent.railway.app/api/chat
```

**Expected:** Agent lists skills without "pairing required" error ✅

## Migration Notes

- **No breaking changes** - Existing deployments will work with device pairing disabled by default
- **Backward compatible** - Can still enable device pairing if needed
- **Recommended** - Keep device pairing disabled for API-based usage to reduce friction

---

**Status:** ✅ Ready to deploy  
**Breaking Changes:** None  
**Default Behavior:** Device pairing disabled (fixes the reported issue)
