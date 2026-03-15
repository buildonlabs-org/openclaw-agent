#!/bin/bash
# Diagnostic script to check cron jobs and webhook configuration

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

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Diagnosing Cron Job Webhook Issue"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: List cron jobs via chat (to see what OpenClaw returns)
echo "Step 1: Listing cron jobs via agent chat..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "run this command: openclaw cron list"}' \
  "$AGENT_URL/api/chat")

echo "$response" | jq '.' 2>/dev/null || echo "$response"
echo ""

# Step 2: Check notification status
echo "Step 2: Checking notification configuration..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -H "Authorization: Bearer $WRAPPER_API_KEY" \
  "$AGENT_URL/api/notifications/status")

echo "$response" | jq '.' 2>/dev/null || echo "$response"

configured=$(echo "$response" | jq -r '.configured' 2>/dev/null || echo "false")
if [ "$configured" = "true" ]; then
  echo -e "${GREEN}✅ Notifications are configured${NC}"
else
  echo -e "${RED}❌ Notifications NOT configured - set environment variables on Railway${NC}"
  exit 1
fi
echo ""

# Step 3: Get webhook URL
echo "Step 3: Getting webhook URL..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -H "Authorization: Bearer $WRAPPER_API_KEY" \
  "$AGENT_URL/api/cron/webhook-url")

echo "$response" | jq '.' 2>/dev/null || echo "$response"
WEBHOOK_URL=$(echo "$response" | jq -r '.webhookUrl' 2>/dev/null)
echo ""
echo "Cron jobs should be configured to use: $WEBHOOK_URL"
echo ""

# Step 4: Try to audit webhooks (with improved error handling)
echo "Step 4: Attempting to audit and fix cron job webhooks..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  "$AGENT_URL/api/cron/audit-webhooks")

echo "$response" | jq '.' 2>/dev/null || echo "$response"

ok=$(echo "$response" | jq -r '.ok' 2>/dev/null || echo "false")
if [ "$ok" = "true" ]; then
  echo -e "${GREEN}✅ Audit completed successfully!${NC}"
  
  total=$(echo "$response" | jq -r '.summary.total' 2>/dev/null || echo "0")
  fixed=$(echo "$response" | jq -r '.summary.fixed' 2>/dev/null || echo "0")
  already=$(echo "$response" | jq -r '.summary.alreadyConfigured' 2>/dev/null || echo "0")
  
  echo ""
  echo "Summary:"
  echo "  Total jobs: $total"
  echo "  Already configured: $already"
  echo "  Fixed: $fixed"
  
  if [ "$total" = "0" ]; then
    echo ""
    echo -e "${YELLOW}⚠️  No cron jobs found!${NC}"
    echo "You need to create cron jobs first. You can do this via the chat interface:"
    echo ""
    echo "Example:"
    echo "  curl -X POST -H \"Authorization: Bearer $WRAPPER_API_KEY\" \\"
    echo "    -H \"Content-Type: application/json\" \\"
    echo "    -d '{\"message\": \"create a cron job that checks polymarket markets every hour\"}' \\"
    echo "    $AGENT_URL/api/chat"
  elif [ "$fixed" -gt "0" ]; then
    echo -e "${GREEN}✅ Fixed $fixed cron job(s)!${NC}"
    echo "Cron notifications should now work."
  else
    echo -e "${GREEN}✅ All cron jobs already have webhooks configured!${NC}"
  fi
else
  echo -e "${RED}❌ Audit failed${NC}"
  error=$(echo "$response" | jq -r '.error' 2>/dev/null || echo "Unknown error")
  echo "Error: $error"
  
  # Check if it's a parse error
  if echo "$error" | grep -q "not iterable\|parse"; then
    echo ""
    echo "This suggests the OpenClaw CLI output format is unexpected."
    echo "Let's try to get the raw output via chat API..."
    echo ""
    
    echo "Requesting: openclaw cron list --json"
    response=$(curl -s -X POST \
      -H "Authorization: Bearer $WRAPPER_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"message": "run this exact command and show me the full output: openclaw cron list --json"}' \
      "$AGENT_URL/api/chat")
    
    echo "$response" | jq '.' 2>/dev/null || echo "$response"
  fi
fi
echo ""

# Step 5: Test notification delivery
echo "Step 5: Testing notification delivery..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
response=$(curl -s -X POST \
  -H "Authorization: Bearer $WRAPPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron",
    "title": "Diagnostic Test",
    "message": "Testing cron notification delivery"
  }' \
  "$AGENT_URL/api/notifications/test")

echo "$response" | jq '.' 2>/dev/null || echo "$response"

sent=$(echo "$response" | jq -r '.sent' 2>/dev/null || echo "false")
if [ "$sent" = "true" ]; then
  echo -e "${GREEN}✅ Test notification sent!${NC}"
  echo "Check your frontend - did you see it?"
else
  echo -e "${RED}❌ Test notification failed${NC}"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "1. If no cron jobs exist, create one via the chat interface"
echo "2. If cron jobs exist but audit failed, deploy the updated code"
echo "3. If test notification worked, trigger a real cron job to verify"
echo ""
