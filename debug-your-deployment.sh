#!/bin/bash
# Debug script for your specific Railway deployment

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "🔍 Debugging Cron Notification Issue"
echo "====================================="
echo ""

# Your specific configuration
WRAPPER_API_KEY="a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087"
LAUNCHER_WEBHOOK_URL="https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/6df09d45-d8d8-42ba-a00a-74283c383488"
LAUNCHER_AGENT_TOKEN="6a1e32d38ed3d5b3093a101739932aa08cf0561135c5baba5775743c0474e04e"

# Railway URLs to try (you need to provide the actual one)
echo -e "${YELLOW}⚠️  You need to provide your Railway deployment URL${NC}"
echo "   Examples:"
echo "   - https://polymarket-trader-production-XXXX.up.railway.app"
echo "   - https://your-service-name.up.railway.app"
echo ""
echo "Enter your Railway deployment URL (or press Ctrl+C to exit):"
read AGENT_URL

if [ -z "$AGENT_URL" ]; then
  echo -e "${RED}❌ No URL provided${NC}"
  exit 1
fi

# Remove trailing slash if present
AGENT_URL="${AGENT_URL%/}"

echo ""
echo "📡 Testing deployment: $AGENT_URL"
echo "🔑 API Key: ${WRAPPER_API_KEY:0:12}..."
echo "🔗 Webhook: ${LAUNCHER_WEBHOOK_URL:0:60}..."
echo ""

# Test 1: Check if agent is reachable
echo "Test 1: Check Agent Health"
echo "---------------------------"
response=$(curl -s -w "\n%{http_code}" "$AGENT_URL/health" || echo -e "\n000")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Agent is reachable${NC}"
else
  echo -e "${RED}❌ Agent is not reachable (HTTP $http_code)${NC}"
  echo "   Check if the URL is correct and the deployment is running"
  exit 1
fi
echo ""

# Test 2: Check notification configuration
echo "Test 2: Check Notification Configuration"
echo "------------------------------------------"
response=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  "$AGENT_URL/api/notifications/status" || echo -e "\n000")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

echo "HTTP Code: $http_code"
if [ "$http_code" = "200" ]; then
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
  
  configured=$(echo "$body" | jq -r '.configured' 2>/dev/null || echo "false")
  if [ "$configured" = "true" ]; then
    echo -e "${GREEN}✅ Notification system is CONFIGURED${NC}"
    echo ""
    echo "Since notifications are configured, let's test the webhook delivery..."
  else
    echo -e "${RED}❌ Notification system is NOT CONFIGURED${NC}"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}📝 FIX REQUIRED: Set Environment Variables on Railway${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Go to your Railway dashboard and set these environment variables:"
    echo ""
    echo "  LAUNCHER_WEBHOOK_URL=$LAUNCHER_WEBHOOK_URL"
    echo ""
    echo "  LAUNCHER_AGENT_TOKEN=$LAUNCHER_AGENT_TOKEN"
    echo ""
    echo "After setting these, redeploy your service and run this script again."
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
  fi
elif [ "$http_code" = "401" ]; then
  echo -e "${RED}❌ Unauthorized - API key is incorrect${NC}"
  echo "   The WRAPPER_API_KEY doesn't match this deployment"
  exit 1
else
  echo -e "${RED}❌ Failed to check status (HTTP $http_code)${NC}"
  echo "$body"
  exit 1
fi
echo ""

# Test 3: Send test notification
echo "Test 3: Send Test Notification"
echo "--------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "info",
    "title": "Test Notification",
    "message": "Testing notification delivery from Railway to frontend webhook"
  }' \
  "$AGENT_URL/api/notifications/test" || echo -e "\n000")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

echo "HTTP Code: $http_code"
if [ "$http_code" = "200" ]; then
  sent=$(echo "$body" | jq -r '.sent' 2>/dev/null || echo "false")
  if [ "$sent" = "true" ]; then
    echo -e "${GREEN}✅ Test notification sent successfully!${NC}"
    echo "   Check your frontend to see if it appeared"
  else
    echo -e "${YELLOW}⚠️  Notification sent but may have failed${NC}"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
  fi
else
  echo -e "${RED}❌ Failed to send test notification (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Test 4: Check cron webhook endpoint
echo "Test 4: Test Cron Webhook Endpoint"
echo "------------------------------------"
echo "Simulating an OpenClaw cron job completion event..."

response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron.finished",
    "job": {
      "id": "test-job-123",
      "name": "Debug Test Cron Job",
      "schedule": "*/5 * * * *"
    },
    "run": {
      "status": "completed",
      "summary": "Test cron job completed successfully",
      "startedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "endedAt": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "duration": 1.5
    }
  }' \
  "$AGENT_URL/api/openclaw-cron-webhook" || echo -e "\n000")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

echo "HTTP Code: $http_code"
if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Cron webhook processed${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
  
  forwarded=$(echo "$body" | jq -r '.forwarded' 2>/dev/null || echo "false")
  if [ "$forwarded" = "true" ]; then
    echo -e "${GREEN}✅ Notification forwarded to frontend webhook${NC}"
    echo "   Check your frontend - the notification should have arrived!"
  else
    echo -e "${YELLOW}⚠️  Webhook processed but notification not forwarded${NC}"
  fi
else
  echo -e "${RED}❌ Failed to process cron webhook (HTTP $http_code)${NC}"
  echo "$body"
fi
echo ""

# Test 5: List cron jobs and check their webhook configuration
echo "Test 5: Check Cron Job Webhook Configuration"
echo "----------------------------------------------"
echo "Asking agent to list cron jobs..."

response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "run this command: openclaw cron list --json"}' \
  "$AGENT_URL/api/chat" || echo -e "\n000")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Chat request successful${NC}"
  echo "$body" | jq '.' 2>/dev/null || echo "$body"
  echo ""
  echo "Check the response for cron jobs and their webhook settings."
  echo "Each job should have a webhook URL configured to:"
  echo "  $AGENT_URL/api/openclaw-cron-webhook"
else
  echo -e "${YELLOW}⚠️  Could not list cron jobs via chat (HTTP $http_code)${NC}"
fi
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "If all tests passed, cron notifications should work!"
echo ""
echo "If notifications still don't appear in the frontend:"
echo "1. Check that LAUNCHER_WEBHOOK_URL and LAUNCHER_AGENT_TOKEN are set on Railway"
echo "2. Ensure your cron jobs have webhook delivery configured"
echo "3. Check Railway logs for notification errors"
echo "4. Verify the frontend webhook endpoint is accessible"
echo ""
echo "To audit and fix all cron jobs to enable webhooks, run:"
echo "  curl -X POST -H \"Authorization: Bearer $WRAPPER_API_KEY\" \\"
echo "    $AGENT_URL/api/cron/audit-webhooks"
echo ""
