#!/bin/bash

# Hyperliquid Trader API Test Script
# Endpoint: hyperliquid-trader-production.up.railway.app
# API Key: bdd2c7faf67b6070a3e508d20fecfc9e4c1e2175c6018b591b77851593a31b5a

set -e  # Exit on error

ENDPOINT="https://hyperliquid-trader-production.up.railway.app"
API_KEY="bdd2c7faf67b6070a3e508d20fecfc9e4c1e2175c6018b591b77851593a31b5a"

echo "========================================="
echo "Testing Hyperliquid Trader API"
echo "Endpoint: $ENDPOINT"
echo "========================================="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function test_endpoint() {
    local name=$1
    local method=$2
    local path=$3
    local data=$4
    
    echo -e "${YELLOW}Testing: $name${NC}"
    echo "Method: $method $path"
    
    if [ -z "$data" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            "$ENDPOINT$path")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" \
            -H "Authorization: Bearer $API_KEY" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$ENDPOINT$path")
    fi
    
    http_code=$(echo "$response" | tail -n 1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ Success (HTTP $http_code)${NC}"
    else
        echo -e "${RED}✗ Failed (HTTP $http_code)${NC}"
    fi
    
    echo "Response:"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    echo ""
    echo "---"
    echo ""
}

# Test 1: Health Check / Status
test_endpoint "1. Get Status" "GET" "/api/status"

# Test 2: Get Current Configuration
test_endpoint "2. Get Current Config" "GET" "/api/config/current"

# Test 3: List Available Models
test_endpoint "3. List Models" "GET" "/api/models"

# Test 4: Get Channel Status
test_endpoint "4. Get Channels Status" "GET" "/api/channels"

# Test 5: List Installed Skills
test_endpoint "5. List Skills" "GET" "/api/skills"

# Test 6: Search Skills
test_endpoint "6. Search Skills (trading)" "GET" "/api/skills/search?q=trading&limit=5"

# Test 7: Get Recent Logs
test_endpoint "7. Get Logs" "GET" "/api/logs?tail=50"

# Test 8: List Active Sessions
test_endpoint "8. List Sessions" "GET" "/api/sessions"

# Test 9: List Pairing Requests
test_endpoint "9. List Pairing Requests" "GET" "/api/pairing"

# Test 10: List Devices
test_endpoint "10. List Devices" "GET" "/api/devices"

# Test 11: Chat with Agent (Simple test)
test_endpoint "11. Chat - Simple Hello" "POST" "/api/chat" \
    '{"message": "Hello! Are you working?", "sessionKey": "test-session-1"}'

# Test 12: Chat - Ask about capabilities
test_endpoint "12. Chat - Ask Capabilities" "POST" "/api/chat" \
    '{"message": "What trading capabilities do you have?", "sessionKey": "test-session-2"}'

# Test 13: Chat - Ask about Hyperliquid
test_endpoint "13. Chat - Hyperliquid Query" "POST" "/api/chat" \
    '{"message": "Can you help me trade on Hyperliquid?", "sessionKey": "test-session-3"}'

echo "========================================="
echo "All tests completed!"
echo "========================================="
