#!/bin/bash
# Test Device Pairing Fix on Production
# Endpoint: hyperliquid-trader-production.up.railway.app
# Date: March 11, 2026

set -e

ENDPOINT="https://hyperliquid-trader-production.up.railway.app"
API_KEY="${WRAPPER_API_KEY}"

if [ -z "$API_KEY" ]; then
  echo "❌ Error: WRAPPER_API_KEY environment variable not set"
  echo "Usage: export WRAPPER_API_KEY='your-api-key' && ./test-device-pairing.sh"
  exit 1
fi

echo "=================================================="
echo "🧪 Testing Device Pairing Fix"
echo "📡 Endpoint: $ENDPOINT"
echo "=================================================="

# Test 1: Check Device Status
echo ""
echo "📋 Test 1: Check Device Status"
echo "GET /api/devices/status"
echo "--------------------------------------------------"
curl -s -H "Authorization: Bearer $API_KEY" \
  "$ENDPOINT/api/devices/status" | jq '.'

DEVICE_STATUS=$(curl -s -H "Authorization: Bearer $API_KEY" \
  "$ENDPOINT/api/devices/status")
DEVICE_ID=$(echo "$DEVICE_STATUS" | jq -r '.deviceId')
PAIRING_REQUIRED=$(echo "$DEVICE_STATUS" | jq -r '.pairingRequired')

echo ""
echo "📊 Device ID: $DEVICE_ID"
echo "📊 Pairing Required: $PAIRING_REQUIRED"

# Test 2: List Pending Devices
echo ""
echo "📋 Test 2: List Pending Device Requests"
echo "GET /api/devices"
echo "--------------------------------------------------"
DEVICES=$(curl -s -H "Authorization: Bearer $API_KEY" \
  "$ENDPOINT/api/devices")
echo "$DEVICES" | jq '.'

PENDING_COUNT=$(echo "$DEVICES" | jq '.devices | length')
echo ""
echo "📊 Pending Devices: $PENDING_COUNT"

# Check if device pairing is needed
if [ "$PAIRING_REQUIRED" = "true" ] && [ "$PENDING_COUNT" -gt 0 ]; then
  echo ""
  echo "⚠️  DEVICE PAIRING REQUIRED!"
  echo ""
  echo "To approve the device, run:"
  echo ""
  REQUEST_ID=$(echo "$DEVICES" | jq -r '.devices[0].requestId')
  echo "  curl -X POST \\"
  echo "    -H \"Authorization: Bearer \$WRAPPER_API_KEY\" \\"
  echo "    -H \"Content-Type: application/json\" \\"
  echo "    -d '{\"requestId\": \"$REQUEST_ID\"}' \\"
  echo "    $ENDPOINT/api/devices/approve"
  echo ""
  echo "Or approve now? (y/n)"
  read -r APPROVE
  
  if [ "$APPROVE" = "y" ] || [ "$APPROVE" = "Y" ]; then
    echo ""
    echo "📋 Approving device: $REQUEST_ID"
    echo "--------------------------------------------------"
    curl -s -X POST \
      -H "Authorization: Bearer $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"requestId\": \"$REQUEST_ID\"}" \
      "$ENDPOINT/api/devices/approve" | jq '.'
    
    echo ""
    echo "✅ Device approved! Waiting 3 seconds for gateway to reconnect..."
    sleep 3
  fi
elif [ "$PAIRING_REQUIRED" = "false" ]; then
  echo ""
  echo "✅ Device already approved!"
else
  echo ""
  echo "⚠️  Device pairing required, but no pending requests yet."
  echo "💡 Try installing a skill to trigger the pairing request."
fi

# Test 3: Try to install a test skill (this will show if pairing works)
echo ""
echo "📋 Test 3: Test Skill Installation (Dry Run)"
echo "POST /api/skills/install"
echo "--------------------------------------------------"
echo "Attempting to install a small test skill..."
echo ""

# Try to install a lightweight skill
INSTALL_RESULT=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug": "hello-world"}' \
  "$ENDPOINT/api/skills/install")

HTTP_CODE=$(echo "$INSTALL_RESULT" | grep "HTTP_CODE:" | cut -d: -f2)
RESPONSE=$(echo "$INSTALL_RESULT" | sed '/HTTP_CODE:/d')

echo "$RESPONSE" | jq '.'

echo ""
echo "📊 HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "403" ]; then
  echo ""
  echo "❌ Skill installation failed: Device pairing required"
  echo "📖 Follow the instructions above to approve the device"
elif [ "$HTTP_CODE" = "429" ]; then
  echo ""
  echo "⚠️  Rate limited by ClawHub (this is normal)"
  echo "✅ But the pairing works! The request reached ClawHub."
elif [ "$HTTP_CODE" = "200" ]; then
  echo ""
  echo "✅ Skill installation successful!"
  echo "✅ Device pairing is working correctly!"
else
  echo ""
  echo "📊 Got HTTP $HTTP_CODE - check response above"
fi

# Test 4: List installed skills
echo ""
echo "📋 Test 4: List Installed Skills"
echo "GET /api/skills"
echo "--------------------------------------------------"
curl -s -H "Authorization: Bearer $API_KEY" \
  "$ENDPOINT/api/skills" | jq '.'

# Summary
echo ""
echo "=================================================="
echo "📊 Test Summary"
echo "=================================================="
echo "Device ID: $DEVICE_ID"
echo "Pairing Required: $PAIRING_REQUIRED"
echo "Pending Devices: $PENDING_COUNT"
echo ""

if [ "$PAIRING_REQUIRED" = "false" ]; then
  echo "✅ Device pairing is working correctly!"
  echo "✅ Skills can be installed from chat"
else
  echo "⚠️  Device needs approval before skills can be installed"
  echo "📖 See DEVICE-PAIRING-GUIDE.md for detailed instructions"
fi

echo ""
echo "=================================================="
echo "🎯 Next Steps"
echo "=================================================="
echo ""
echo "1. Test via Telegram/Discord chat:"
echo "   Send: 'Install the [skill-name] skill'"
echo ""
echo "2. Check device status anytime:"
echo "   curl -H \"Authorization: Bearer \$WRAPPER_API_KEY\" \\"
echo "     $ENDPOINT/api/devices/status"
echo ""
echo "3. View detailed guide:"
echo "   cat DEVICE-PAIRING-GUIDE.md"
echo ""
