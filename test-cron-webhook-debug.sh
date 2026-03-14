#!/bin/bash
# Debug script for OpenClaw cron webhook notifications

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🔍 OpenClaw Cron Webhook Notification Debug"
echo "=============================================="
echo ""

# Agent configuration
AGENT_URL="https://polymarket-trader-production-7c0d.up.railway.app"
AGENT_API_KEY="c9eba8e28cbbf91313066a32a655405875abf123c40fd5028e194de11d8926f9"

# Frontend webhook configuration
FRONTEND_WEBHOOK_URL="https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/79581172-b5f2-477f-a88b-c12c9c745f25"
FRONTEND_TOKEN="e03d30cf0f7b7604bc81ac0cb670f8d784d203149b375df616c600e3fbac2acb"

echo "📡 Agent URL: $AGENT_URL"
echo "🔗 Frontend Webhook: ${FRONTEND_WEBHOOK_URL:0:80}..."
echo ""

# Test 1: Check agent notification status
echo "Test 1: Check Agent Notification Configuration"
echo "------------------------------------------------"
response=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $AGENT_API_KEY" \
  "$AGENT_URL/api/notifications/status")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "HTTP Code: $http_code"
echo "Response: $body" | jq '.' 2>/dev/null || echo "$body"

if [ "$http_code" = "200" ]; then
  configured=$(echo "$body" | jq -r '.configured' 2>/dev/null || echo "false")
  if [ "$configured" = "true" ]; then
    echo -e "${GREEN}✅ Agent webhook is configured${NC}"
  else
    echo -e "${RED}❌ Agent webhook NOT configured${NC}"
    echo "   Set LAUNCHER_WEBHOOK_URL and LAUNCHER_AGENT_TOKEN on Railway"
    exit 1
  fi
else
  echo -e "${RED}❌ Failed to check status${NC}"
  exit 1
fi
echo ""

# Test 2: Send test notification via agent API
echo "Test 2: Send Test Notification via Agent API"
echo "----------------------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron",
    "title": "Debug Test Cron",
    "message": "Testing cron notification delivery from agent to frontend"
  }' \
  "$AGENT_URL/api/notifications/test")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "HTTP Code: $http_code"
echo "Response: $body" | jq '.' 2>/dev/null || echo "$body"

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Test notification sent via agent${NC}"
else
  echo -e "${RED}❌ Failed to send test notification (HTTP $http_code)${NC}"
fi
echo ""

# Test 3: Direct test to frontend webhook (bypass agent)
echo "Test 3: Direct Test to Frontend Webhook (Bypass Agent)"
echo "--------------------------------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-Agent-Token: $FRONTEND_TOKEN" \
  -d '{
    "type": "cron",
    "title": "Direct Test Cron",
    "message": "Testing direct delivery to frontend webhook",
    "data": {
      "source": "debug-script",
      "timestamp": "'"$(date -Iseconds)"'"
    }
  }' \
  "$FRONTEND_WEBHOOK_URL")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "HTTP Code: $http_code"
echo "Response: $body" | jq '.' 2>/dev/null || echo "$body"

if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
  echo -e "${GREEN}✅ Direct frontend webhook works${NC}"
else
  echo -e "${RED}❌ Frontend webhook failed (HTTP $http_code)${NC}"
fi
echo ""

# Test 4: Simulate OpenClaw cron webhook payload
echo "Test 4: Simulate OpenClaw Cron Webhook to Agent"
echo "-------------------------------------------------"
response=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron.finished",
    "job": {
      "id": "test-job-123",
      "name": "Debug Test Cron Job",
      "schedule": {"kind": "cron", "expr": "*/5 * * * *"}
    },
    "run": {
      "status": "success",
      "summary": "Debug test completed successfully",
      "startedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "endedAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
      "duration": 1234
    }
  }' \
  "$AGENT_URL/api/openclaw-cron-webhook")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

echo "HTTP Code: $http_code"
echo "Response: $body" | jq '.' 2>/dev/null || echo "$body"

if [ "$http_code" = "200" ]; then
  echo -e "${GREEN}✅ Cron webhook endpoint received payload${NC}"
else
  echo -e "${RED}❌ Cron webhook endpoint failed (HTTP $http_code)${NC}"
fi
echo ""

# Summary
echo "=============================================="
echo "📊 Summary"
echo "=============================================="
echo ""
echo "If all tests passed but notifications aren't showing:"
echo "  1. Check frontend logs for incoming webhook requests"
echo "  2. Check agent logs on Railway for notification errors"
echo "  3. Verify LAUNCHER_WEBHOOK_URL and LAUNCHER_AGENT_TOKEN match"
echo "  4. Check for network/firewall issues between agent and frontend"
echo ""
echo "Environment Variables to Set on Railway:"
echo "  LAUNCHER_WEBHOOK_URL=$FRONTEND_WEBHOOK_URL"
echo "  LAUNCHER_AGENT_TOKEN=$FRONTEND_TOKEN"
echo ""
