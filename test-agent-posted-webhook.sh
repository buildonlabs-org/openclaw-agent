#!/bin/bash

# Test script for new agent-posted webhook format
# This validates that the webhook endpoint correctly handles full content POSTed by agents

echo "🧪 Testing Agent-Posted Webhook Format"
echo "======================================"
echo ""

# Configuration
AGENT_URL="${1:-http://localhost:3000}"

echo "📍 Agent URL: $AGENT_URL"
echo "🔔 Note: Webhook endpoint does not require API key"
echo ""

# Test 1: Agent-posted full content (NEW format)
echo "Test 1: Agent-posted full content (NEW primary format)"
echo "-------------------------------------------------------"
RESPONSE=$(curl -s -X POST \
  "${AGENT_URL}/api/openclaw-cron-webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "jobName": "Test Polymarket Odds Job",
    "status": "success",
    "content": "# 2028 Presidential Election Odds\n\n- Trump: 45.2%\n- Biden: 32.1%\n- Harris: 15.7%\n- Other: 7.0%",
    "timestamp": "2026-03-15T10:30:00Z",
    "jobId": "job-123",
    "duration": 1250
  }')

echo "Response: $RESPONSE"
echo ""

# Check if response indicates success
if [[ $RESPONSE == *"\"ok\":true"* ]] && [[ $RESPONSE == *"\"received\":true"* ]]; then
  echo "✅ Test 1 PASSED - Agent-posted content accepted"
else
  echo "❌ Test 1 FAILED - Response: $RESPONSE"
fi
echo ""

# Test 2: Old webhook delivery format (for backward compatibility)
echo "Test 2: Old cron.finished event format (deprecated)"
echo "----------------------------------------------------"
RESPONSE=$(curl -s -X POST \
  "${AGENT_URL}/api/openclaw-cron-webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "cron.finished",
    "job": {
      "id": "job-456",
      "name": "Old Format Job",
      "schedule": {
        "kind": "cron",
        "cron": "* * * * *"
      }
    },
    "run": {
      "runId": "run-789",
      "status": "success",
      "summary": "Completed successfully"
    }
  }')

echo "Response: $RESPONSE"
echo ""

# Check if response indicates success
if [[ $RESPONSE == *"\"ok\":true"* ]] && [[ $RESPONSE == *"\"received\":true"* ]]; then
  echo "⚠️  Test 2 PASSED - Old format still accepted (but only has summary)"
else
  echo "❌ Test 2 FAILED - Response: $RESPONSE"
fi
echo ""

# Test 3: Verify event type detection
echo "Test 3: Verify event type detection"
echo "------------------------------------"
RESPONSE=$(curl -s -X POST \
  "${AGENT_URL}/api/openclaw-cron-webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "jobName": "Event Type Test",
    "status": "success",
    "content": "Full content here",
    "timestamp": "2026-03-15T10:35:00Z"
  }')

echo "Response: $RESPONSE"
echo ""

# Check if eventType is "agent-posted"
if [[ $RESPONSE == *"\"eventType\":\"agent-posted\""* ]]; then
  echo "✅ Test 3 PASSED - Event type correctly identified as 'agent-posted'"
else
  echo "❌ Test 3 FAILED - Event type not correctly identified"
fi
echo ""

echo "======================================"
echo "🏁 Test Summary"
echo "======================================"
echo ""
echo "Expected behavior:"
echo "✅ New agent-posted format provides FULL content"
echo "⚠️  Old webhook delivery format only provides summary"
echo ""
echo "Migration strategy:"
echo "1. Update cron jobs to use delivery=none"
echo "2. Have agents POST full results themselves"
echo "3. Backward compatibility maintained for old format"
