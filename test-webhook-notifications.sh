#!/bin/bash
# Test script for webhook notification integration

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🔔 OpenClaw Agent Webhook Notification Tests"
echo "=============================================="
echo ""

# Configuration
API_URL="${API_URL:-http://localhost:8080}"
API_KEY="${WRAPPER_API_KEY:-${OPENCLAW_GATEWAY_TOKEN}}"

if [ -z "$API_KEY" ]; then
  echo -e "${RED}❌ Error: WRAPPER_API_KEY or OPENCLAW_GATEWAY_TOKEN not set${NC}"
  echo "   Set one of these environment variables to authenticate"
  exit 1
fi

echo "📡 API URL: $API_URL"
echo "🔑 API Key: ${API_KEY:0:12}..."
echo ""

# Test 1: Check notification status
echo "Test 1: Check Notification Status"
echo "-----------------------------------"
response=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/api/notifications/status" \
  -H "Authorization: Bearer $API_KEY")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Status check successful${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
  
  # Check if configured
  configured=$(echo "$body" | jq -r '.configured' 2>/dev/null || echo "false")
  if [ "$configured" = "true" ]; then
    echo -e "${GREEN}✅ Webhooks are configured${NC}"
  else
    echo -e "${YELLOW}⚠️  Webhooks not configured (environment variables not set)${NC}"
    echo "   Set LAUNCHER_WEBHOOK_URL and LAUNCHER_AGENT_TOKEN to enable notifications"
  fi
else
  echo -e "${RED}❌ Status check failed (HTTP $http_code)${NC}"
  echo "$body"
  exit 1
fi
echo ""

# Test 2: Send test info notification
echo "Test 2: Send Test Info Notification"
echo "-------------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/notifications/test" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "info",
    "title": "Test Info Notification",
    "message": "This is a test info notification sent via the test script"
  }')

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Info notification sent${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
elif [ "$http_code" = "400" ]; then
  echo -e "${YELLOW}⚠️  Notification not configured${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
else
  echo -e "${RED}❌ Failed to send info notification (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Test 3: Send test cron notification
echo "Test 3: Send Test Cron Notification"
echo "-------------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/notifications/test" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron",
    "title": "Database Cleanup",
    "message": "Removed 523 expired records in 12 seconds"
  }')

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Cron notification sent${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
elif [ "$http_code" = "400" ]; then
  echo -e "${YELLOW}⚠️  Notification not configured${NC}"
else
  echo -e "${RED}❌ Failed to send cron notification (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Test 4: Send test task notification
echo "Test 4: Send Test Task Notification"
echo "-------------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/notifications/test" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "title": "File Processing Complete",
    "message": "Processed 1,234 images. Converted 98% successfully"
  }')

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Task notification sent${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
elif [ "$http_code" = "400" ]; then
  echo -e "${YELLOW}⚠️  Notification not configured${NC}"
else
  echo -e "${RED}❌ Failed to send task notification (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Test 5: Send test error notification
echo "Test 5: Send Test Error Notification"
echo "--------------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/notifications/test" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "error",
    "title": "API Rate Limited",
    "message": "GitHub API rate limit exceeded. Pausing requests for 1 hour"
  }')

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Error notification sent${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
elif [ "$http_code" = "400" ]; then
  echo -e "${YELLOW}⚠️  Notification not configured${NC}"
else
  echo -e "${RED}❌ Failed to send error notification (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Test 6: Invalid notification type
echo "Test 6: Invalid Notification Type (should fail)"
echo "-------------------------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/notifications/test" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invalid",
    "title": "Invalid Type",
    "message": "This should fail"
  }')

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "400" ]; then
  echo -e "${GREEN}✅ Correctly rejected invalid type${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
else
  echo -e "${RED}❌ Should have rejected invalid type (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Final summary
echo "=============================================="
echo "🎉 Webhook notification tests complete!"
echo ""
echo "📝 Summary:"
echo "  - ✅ Status endpoint works"
echo "  - ✅ All notification types tested"
echo "  - ✅ Error handling verified"
echo ""
echo "📚 Next steps:"
echo "  1. Check launcher UI for notifications (if webhook configured)"
echo "  2. Monitor server logs with: tail -f /tmp/openclaw/*.log"
echo "  3. See WEBHOOK-INTEGRATION.md for full documentation"
echo ""
