#!/bin/bash

# Test Trading Credentials Validation
# Demonstrates the helpful error messages when API keys are missing

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENDPOINT="${ENDPOINT:-http://localhost:8080}"
API_KEY="${WRAPPER_API_KEY:-your-api-key-here}"

echo ""
echo "========================================="
echo "Trading Credentials Validation Tests"
echo "========================================="
echo ""
echo "Endpoint: $ENDPOINT"
echo ""

function test_trading_message() {
    local test_name="$1"
    local message="$2"
    local platform="$3"
    
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Test: ${test_name}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Message: \"$message\""
    echo "Expected platform detection: $platform"
    echo ""
    echo "Response:"
    echo ""
    
    response=$(curl -s -X POST \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"$message\"}" \
        "$ENDPOINT/api/chat")
    
    echo "$response" | jq '.'
    
    # Check if error response includes setup instructions
    has_instructions=$(echo "$response" | jq -r '.setupInstructions // empty')
    
    if [ -n "$has_instructions" ]; then
        echo ""
        echo -e "${GREEN}✓ Setup instructions provided!${NC}"
        echo ""
        echo "Setup Instructions:"
        echo "-------------------"
        echo "$response" | jq -r '.setupInstructions'
    else
        echo ""
        echo -e "${RED}✗ No setup instructions (credentials may be configured)${NC}"
    fi
    
    echo ""
}

# Test 1: Polymarket trading
test_trading_message \
    "Polymarket Trading Detection" \
    "can you trade on polymarket" \
    "polymarket"

# Test 2: Hyperliquid trading
test_trading_message \
    "Hyperliquid Trading Detection" \
    "I want to trade on hyperliquid" \
    "hyperliquid"

# Test 3: Generic trading (Polymarket mentioned)
test_trading_message \
    "Generic Trading with Polymarket" \
    "help me place a trade on polymarket for the election" \
    "polymarket"

# Test 4: Generic trading keywords
test_trading_message \
    "Generic Trading Keywords" \
    "can you help me place an order" \
    "trading"

# Test 5: DeFi trading
test_trading_message \
    "DeFi Trading Detection" \
    "can you help me trade on uniswap" \
    "defi"

# Test 6: Non-trading message (should not trigger validation)
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Test: Non-Trading Message (Control)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Message: \"What's the weather today?\""
echo "Expected: No credential check"
echo ""
echo "Response:"
echo ""

curl -s -X POST \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"message": "What is the weather today?"}' \
    "$ENDPOINT/api/chat" | jq '.'

echo ""
echo "========================================="
echo "Tests Complete!"
echo "========================================="
echo ""
echo "Summary:"
echo "--------"
echo "• Trading requests are detected automatically"
echo "• Missing credentials return helpful setup instructions"
echo "• Non-trading messages pass through normally"
echo ""
echo "To fix missing credentials errors:"
echo "1. Add required environment variables in Railway"
echo "2. See TRADING-CREDENTIALS-GUIDE.md for details"
echo ""
