#!/bin/bash

# Test script for model selection feature
# This demonstrates how to fetch and use available models

API_KEY="f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659"
BASE_URL="http://localhost:8080"

echo "========================================="
echo "OpenClaw Model Selection Test"
echo "========================================="
echo ""

echo "1. Fetching available models..."
echo "---------------------------------------"
MODELS_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" "$BASE_URL/api/models")

if [ $? -eq 0 ]; then
  echo "$MODELS_RESPONSE" | jq '.'
  
  echo ""
  echo "2. Extracting model list..."
  echo "---------------------------------------"
  echo "$MODELS_RESPONSE" | jq -r '.models[] | "\(.provider)/\(.name) - \(.details // "no details")"'
  
  echo ""
  echo "3. Models grouped by provider..."
  echo "---------------------------------------"
  echo "$MODELS_RESPONSE" | jq -r '
    .models 
    | group_by(.provider) 
    | map({
        provider: .[0].provider,
        count: length,
        models: map(.name)
      })
    | .[]
    | "\(.provider | ascii_upcase): \(.count) models - \(.models | join(", "))"
  '
  
  echo ""
  echo "4. Example: Configure with a specific model"
  echo "---------------------------------------"
  
  # Extract first available model
  FIRST_MODEL=$(echo "$MODELS_RESPONSE" | jq -r '.models[0].fullName // .models[0].name // .models[0].raw')
  
  if [ -n "$FIRST_MODEL" ] && [ "$FIRST_MODEL" != "null" ]; then
    echo "Available model example: $FIRST_MODEL"
    echo ""
    echo "To configure with this model:"
    echo ""
    echo "curl -X POST \\"
    echo "  -H \"Authorization: Bearer $API_KEY\" \\"
    echo "  -H \"Content-Type: application/json\" \\"
    echo "  -d '{"
    echo "    \"authChoice\": \"openai-api-key\","
    echo "    \"authSecret\": \"sk-YOUR-API-KEY\","
    echo "    \"model\": \"$FIRST_MODEL\""
    echo "  }' \\"
    echo "  $BASE_URL/api/configure"
  else
    echo "No models found. Make sure OpenClaw CLI is installed."
  fi
  
else
  echo "❌ Failed to fetch models"
  echo "Make sure:"
  echo "  1. The server is running (docker run or npm start)"
  echo "  2. The API_KEY is correct"
  echo "  3. OpenClaw CLI is installed in the container"
fi

echo ""
echo "========================================="
echo "Test complete"
echo "========================================="
