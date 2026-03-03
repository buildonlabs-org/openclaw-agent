#!/bin/bash

# Test script for /api/chat endpoint

set -e

echo "=== OpenClaw Agent Chat API Test ==="
echo ""

# Get the API key from environment or prompt
if [ -z "$WRAPPER_API_KEY" ] && [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  echo "Error: Neither WRAPPER_API_KEY nor OPENCLAW_GATEWAY_TOKEN is set"
  echo "Please set one of these environment variables"
  exit 1
fi

API_KEY="${WRAPPER_API_KEY:-$OPENCLAW_GATEWAY_TOKEN}"

# Determine the base URL
if [ -n "$CODESPACE_NAME" ]; then
  # Running in GitHub Codespaces
  PORT="${PORT:-8080}"
  BASE_URL="https://${CODESPACE_NAME}-${PORT}.app.github.dev"
else
  # Running locally or in Railway
  BASE_URL="${BASE_URL:-http://localhost:8080}"
fi

echo "Testing API at: $BASE_URL"
echo "API Key: ${API_KEY:0:12}..."
echo ""

# Test 1: Check status
echo "1. Checking agent status..."
STATUS_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/api/status")
echo "$STATUS_RESPONSE" | jq '.' || echo "$STATUS_RESPONSE"
echo ""

# Check if gateway is ready
GATEWAY_READY=$(echo "$STATUS_RESPONSE" | jq -r '.gateway.reachable // false')
if [ "$GATEWAY_READY" != "true" ]; then
  echo "❌ Gateway is not ready. Status response:"
  echo "$STATUS_RESPONSE" | jq '.' || echo "$STATUS_RESPONSE"
  echo ""
  echo "Possible issues:"
  echo "- Gateway not configured (run setup first)"
  echo "- Gateway failed to start (check logs)"
  exit 1
fi

echo "✓ Gateway is ready"
echo ""

# Test 2: Simple chat message
echo "2. Sending test message..."
CHAT_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello! Please respond with just the word OK if you can read this."}' \
  "$BASE_URL/api/chat")

echo "$CHAT_RESPONSE" | jq '.' || echo "$CHAT_RESPONSE"
echo ""

# Check if chat succeeded
CHAT_OK=$(echo "$CHAT_RESPONSE" | jq -r '.ok // false')
if [ "$CHAT_OK" = "true" ]; then
  echo "✓ Chat API working!"
  RESPONSE_TEXT=$(echo "$CHAT_RESPONSE" | jq -r '.response')
  echo "Agent response: $RESPONSE_TEXT"
else
  echo "❌ Chat API failed"
  ERROR_MSG=$(echo "$CHAT_RESPONSE" | jq -r '.error // "Unknown error"')
  echo "Error: $ERROR_MSG"
  echo ""
  echo "Troubleshooting steps:"
  echo "1. Check if gateway is running: curl -H 'Authorization: Bearer $API_KEY' $BASE_URL/api/status"
  echo "2. Check logs: curl -H 'Authorization: Bearer $API_KEY' $BASE_URL/api/logs?tail=100"
  echo "3. Run doctor: curl -X POST -H 'Authorization: Bearer $API_KEY' $BASE_URL/api/doctor"
  exit 1
fi

echo ""
echo "=== All tests passed! ==="
