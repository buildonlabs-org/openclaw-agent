#!/bin/bash
# Find which Railway deployment URL matches your wrapper API key

set -e

WRAPPER_API_KEY="a20d9cae91f4274da0044818986b182305a088ebd6c81185af7b21302647d087"

echo "🔍 Finding your agent deployment..."
echo ""
echo "Testing common Railway URL patterns..."
echo ""

# Common patterns for Railway URLs
# You mentioned polymarket-trader-production-2835 earlier, let's try variations

URLS_TO_TRY=(
  "https://openclaw-agent-production.up.railway.app"
  "https://polymarket-trader-production-2835.up.railway.app"
  "https://openclaw-production.up.railway.app"
  "https://agent-production.up.railway.app"
)

echo "Please provide any Railway deployment URLs you know about (or press Enter to skip):"
echo "Example: https://your-service.up.railway.app"
read CUSTOM_URL

if [ ! -z "$CUSTOM_URL" ]; then
  URLS_TO_TRY+=("$CUSTOM_URL")
fi

echo ""
echo "Testing URLs..."
echo ""

FOUND_URL=""

for URL in "${URLS_TO_TRY[@]}"; do
  echo -n "Testing $URL... "
  
  # Remove trailing slash
  URL="${URL%/}"
  
  # Try health endpoint first (doesn't require auth)
  response=$(curl -s -w "\n%{http_code}" --max-time 5 "$URL/health" 2>/dev/null || echo -e "\n000")
  http_code=$(echo "$response" | tail -n1)
  
  if [ "$http_code" = "200" ]; then
    echo "reachable ✓"
    
    # Now try with API key
    echo -n "  Checking API key... "
    response=$(curl -s -w "\n%{http_code}" --max-time 5 \
      -H "Authorization: Bearer $WRAPPER_API_KEY" \
      "$URL/api/notifications/status" 2>/dev/null || echo -e "\n000")
    
    http_code=$(echo "$response" | tail -n1)
    
    if [ "$http_code" = "200" ]; then
      echo "✅ MATCH FOUND!"
      FOUND_URL="$URL"
      break
    elif [ "$http_code" = "401" ]; then
      echo "wrong API key ✗"
    else
      echo "no authentication endpoint ✗"
    fi
  else
    echo "not reachable ✗"
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -z "$FOUND_URL" ]; then
  echo "✅ Found your agent deployment!"
  echo ""
  echo "Agent URL: $FOUND_URL"
  echo ""
  echo "Now checking notification configuration..."
  echo ""
  
  response=$(curl -s -H "Authorization: Bearer $WRAPPER_API_KEY" \
    "$FOUND_URL/api/notifications/status")
  
  echo "$response" | jq '.' 2>/dev/null || echo "$response"
  
  configured=$(echo "$response" | jq -r '.configured' 2>/dev/null || echo "false")
  
  if [ "$configured" = "true" ]; then
    echo ""
    echo "✅ Notifications are already configured!"
    echo "Your cron jobs should be working. If not, run:"
    echo ""
    echo "  curl -X POST -H \"Authorization: Bearer $WRAPPER_API_KEY\" \\"
    echo "    $FOUND_URL/api/cron/audit-webhooks"
  else
    echo ""
    echo "❌ Notifications NOT configured"
    echo ""
    echo "Go to Railway dashboard and set these environment variables:"
    echo ""
    echo "  LAUNCHER_WEBHOOK_URL=https://laughing-pancake-x5jqw7r5qww365x-3000.app.github.dev/api/notifications/webhook/6df09d45-d8d8-42ba-a00a-74283c383488"
    echo ""
    echo "  LAUNCHER_AGENT_TOKEN=6a1e32d38ed3d5b3093a101739932aa08cf0561135c5baba5775743c0474e04e"
  fi
else
  echo "❌ Could not find agent deployment"
  echo ""
  echo "Please provide your Railway deployment URL manually."
  echo "You can find it in Railway dashboard under your agent service settings."
  echo ""
  echo "Once you have it, test with:"
  echo ""
  echo "  curl -H \"Authorization: Bearer $WRAPPER_API_KEY\" \\"
  echo "    https://YOUR-AGENT-URL/api/notifications/status"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
