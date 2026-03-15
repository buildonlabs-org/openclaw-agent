#!/bin/bash
# Complete fix script for polymarket-trader-production-378a.up.railway.app

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Your configuration
AGENT_URL="https://polymarket-trader-production-378a.up.railway.app"
WRAPPER_API_KEY="a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087"
LAUNCHER_WEBHOOK_URL="https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/6df09d45-d8d8-42ba-a00a-74283c383488"
LAUNCHER_AGENT_TOKEN="6a1e32d38ed3d5b3093a101739932aa08cf0561135c5baba5775743c0474e04e"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Fixing Cron Notifications for Polymarket Trader Agent"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Agent URL: $AGENT_URL"
echo "API Key: ${WRAPPER_API_KEY:0:12}..."
echo ""

# Test 1: Health check
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Checking if agent is reachable..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -w "\n%{http_code}" "$AGENT_URL/health" 2>/dev/null || echo -e "\n000")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Agent is reachable!${NC}"
else
  echo -e "${RED}❌ Agent is not reachable (HTTP $http_code)${NC}"
  echo "   Make sure the deployment is running on Railway"
  exit 1
fi
echo ""

# Test 2: Check notification configuration
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Checking notification configuration..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  "$AGENT_URL/api/notifications/status" 2>/dev/null || echo -e "\n000")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "401" ]; then
  echo -e "${RED}❌ API key is incorrect!${NC}"
  echo "   The wrapper API key doesn't match this deployment"
  exit 1
elif [ "$http_code" != "200" ]; then
  echo -e "${RED}❌ Failed to check status (HTTP $http_code)${NC}"
  echo "$body"
  exit 1
fi

echo "$body" | jq '.' 2>/dev/null || echo "$body"
echo ""

configured=$(echo "$body" | jq -r '.configured' 2>/dev/null || echo "false")

if [ "$configured" = "true" ]; then
  echo -e "${GREEN}✅ Notifications are ALREADY CONFIGURED!${NC}"
  echo ""
  echo "Great! The environment variables are set. Now let's fix the cron jobs..."
  SKIP_TO_CRON=true
else
  echo -e "${RED}❌ Notifications are NOT CONFIGURED${NC}"
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}📝 ACTION REQUIRED: Set Environment Variables on Railway${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "1. Go to: https://railway.com/project/9a742cdc-6daf-4160-8b82-0fe15c1adabc"
  echo ""
  echo "2. Find your agent service (polymarket-trader-production-378a)"
  echo ""
  echo "3. Click on Variables tab"
  echo ""
  echo "4. Add these TWO environment variables:"
  echo ""
  echo "   Variable Name: LAUNCHER_WEBHOOK_URL"
  echo "   Value: $LAUNCHER_WEBHOOK_URL"
  echo ""
  echo "   Variable Name: LAUNCHER_AGENT_TOKEN"
  echo "   Value: $LAUNCHER_AGENT_TOKEN"
  echo ""
  echo "5. Save and wait for the service to redeploy (should be automatic)"
  echo ""
  echo "6. Run this script again to verify and fix cron jobs"
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  exit 0
fi

# Test 3: Send test notification
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3: Testing notification delivery..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "info",
    "title": "Test Notification",
    "message": "Testing notification delivery from Railway to frontend"
  }' \
  "$AGENT_URL/api/notifications/test" 2>/dev/null || echo -e "\n000")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
  sent=$(echo "$body" | jq -r '.sent' 2>/dev/null || echo "false")
  if [ "$sent" = "true" ]; then
    echo -e "${GREEN}✅ Test notification sent successfully!${NC}"
    echo "   Check your frontend - did you see the notification?"
  else
    echo -e "${YELLOW}⚠️  Notification attempted but may have failed${NC}"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
  fi
else
  echo -e "${RED}❌ Failed to send test notification (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Test 4: Simulate cron webhook
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 4: Testing cron webhook endpoint..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron.finished",
    "job": {
      "id": "test-123",
      "name": "Test Cron Job",
      "schedule": "*/5 * * * *"
    },
    "run": {
      "status": "completed",
      "summary": "Test cron job completed successfully",
      "startedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "endedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "duration": 2.5
    }
  }' \
  "$AGENT_URL/api/openclaw-cron-webhook" 2>/dev/null || echo -e "\n000")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Cron webhook processed!${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
  
  forwarded=$(echo "$body" | jq -r '.forwarded' 2>/dev/null || echo "false")
  if [ "$forwarded" = "true" ]; then
    echo -e "${GREEN}✅ Notification forwarded to frontend!${NC}"
    echo "   Check your frontend - did you see the cron notification?"
  fi
else
  echo -e "${RED}❌ Cron webhook failed (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Test 5: Auto-fix all cron jobs
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 5: Auditing and fixing all cron jobs..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "This will:"
echo "  • List all your cron jobs"
echo "  • Check which ones have webhook delivery configured"
echo "  • Automatically fix any that don't"
echo ""
echo "Running audit..."
echo ""

response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  "$AGENT_URL/api/cron/audit-webhooks" 2>/dev/null || echo -e "\n000")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Audit completed!${NC}"
  echo ""
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
  echo ""
  
  total=$(echo "$body" | jq -r '.summary.total' 2>/dev/null || echo "0")
  fixed=$(echo "$body" | jq -r '.summary.fixed' 2>/dev/null || echo "0")
  
  if [ "$total" = "0" ]; then
    echo -e "${YELLOW}ℹ️  No cron jobs found${NC}"
    echo "   Create cron jobs through the OpenClaw agent chat interface"
  elif [ "$fixed" = "0" ]; then
    echo -e "${GREEN}✅ All $total cron jobs already configured correctly!${NC}"
  else
    echo -e "${GREEN}✅ Fixed $fixed out of $total cron jobs!${NC}"
  fi
else
  echo -e "${RED}❌ Audit failed (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Your cron notifications should now work! When a cron job completes:"
echo "  1. OpenClaw sends webhook to: $AGENT_URL/api/openclaw-cron-webhook"
echo "  2. Agent processes it and forwards to: ${LAUNCHER_WEBHOOK_URL:0:60}..."
echo "  3. Notification appears in your frontend!"
echo ""
echo "To verify everything:"
echo "  • Wait for a cron job to run naturally, OR"
echo "  • Trigger one manually through the chat interface"
echo ""
echo "Useful commands:"
echo ""
echo "  # Check notification status"
echo "  curl -H \"Authorization: Bearer $WRAPPER_API_KEY\" \\"
echo "    $AGENT_URL/api/notifications/status"
echo ""
echo "  # Send test notification"
echo "  curl -X POST -H \"Authorization: Bearer $WRAPPER_API_KEY\" \\"
echo "    -H \"Content-Type: application/json\" \\"
echo "    -d '{\"type\":\"info\",\"title\":\"Test\",\"message\":\"Hello\"}' \\"
echo "    $AGENT_URL/api/notifications/test"
echo ""
echo "  # List cron jobs"
echo "  curl -X POST -H \"Authorization: Bearer $WRAPPER_API_KEY\" \\"
echo "    -H \"Content-Type: application/json\" \\"
echo "    -d '{\"message\":\"run: openclaw cron list\"}' \\"
echo "    $AGENT_URL/api/chat"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
