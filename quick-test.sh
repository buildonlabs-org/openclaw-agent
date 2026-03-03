#!/bin/bash
# Quick test - replace these values with yours

# Your GitHub Codespaces URL (change 'laughing-pancake-x5jqw7r5qww365x' to your actual codespace name)
CODESPACE_NAME="laughing-pancake-x5jqw7r5qww365x"
PORT="8080"  # Default port, change if you set PORT env variable

# Your API key (get from WRAPPER_API_KEY or OPENCLAW_GATEWAY_TOKEN env variable)
API_KEY="your-api-key-here"

# Construct the correct URL
BASE_URL="https://${CODESPACE_NAME}-${PORT}.app.github.dev"

echo "Testing OpenClaw Agent at: $BASE_URL"
echo ""

echo "1. Testing /api/status endpoint..."
curl -s -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/status" | jq '.'
echo ""

echo "2. Testing /api/chat endpoint..."
curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello! Can you respond with just OK?"}' \
  "$BASE_URL/api/chat" | jq '.'
echo ""

echo "If you see 'ok: true' above, your chat API is working!"
echo ""
echo "Correct chat endpoint URL:"
echo "POST $BASE_URL/api/chat"
echo ""
echo "NOT (wrong URL you were using):"
echo "POST $BASE_URL/api/agents/.../proxy/api/chat"
