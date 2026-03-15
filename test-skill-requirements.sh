#!/bin/bash

# Test Skill Requirements Validation
# Demonstrates helpful error messages when skill environment variables are missing

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
echo "Skill Requirements Validation Tests  "
echo "========================================="
echo ""
echo "Endpoint: $ENDPOINT"
echo ""

function test_skill_message() {
    local test_name="$1"
    local message="$2"
    local expected_skill="$3"
    
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Test: ${test_name}${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Message: \"$message\""
    echo "Expected skill detection: $expected_skill"
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
        echo ""
        echo "Missing Variables:"
        echo "$response" | jq -r '.missingVars[]'
    else
        echo ""
        echo -e "${RED}✗ No setup instructions (credentials may be configured or skill not detected)${NC}"
    fi
    
    echo ""
}

# Test 1: Polymarket
test_skill_message \
    "Polymarket Skill Detection" \
    "can you trade on polymarket" \
    "polymarket-odds"

# Test 2: Hyperliquid
test_skill_message \
    "Hyperliquid Skill Detection" \
    "help me trade on hyperliquid" \
    "hyperliquid-cli"

# Test 3: Twitter
test_skill_message \
    "Twitter Skill Detection" \
    "post this to twitter: Hello World!" \
    "twitter"

# Test 4: Telegram
test_skill_message \
    "Telegram Skill Detection" \
    "send a message on telegram" \
    "telegram"

# Test 5: Discord
test_skill_message \
    "Discord Skill Detection" \
    "post to my discord server" \
    "discord"

# Test 6: Gmail
test_skill_message \
    "Gmail Skill Detection" \
    "send an email via gmail to john@example.com" \
    "gmail"

# Test 7: GitHub
test_skill_message \
    "GitHub Skill Detection" \
    "create a github issue in my-repo" \
    "github"

# Test 8: On-chain
test_skill_message \
    "Onchain Skill Detection" \
    "send 0.1 ETH to 0x1234..." \
    "onchain"

# Test 9: Multiple skills
test_skill_message \
    "Multiple Skills Detection" \
    "can you trade on polymarket and post results to twitter" \
    "polymarket-odds, twitter"

# Test 10: Non-skill message (control)
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Test: Non-Skill Message (Control)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Message: \"What's the weather today?\""
echo "Expected: No skill requirements check (duckduckgo-search has no requirements)"
echo ""
echo "Response:"
echo ""

curl -s -X POST \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"message": "Search for weather in San Francisco"}' \
    "$ENDPOINT/api/chat" | jq '.'

echo ""
echo "========================================="
echo "Tests Complete!"
echo "========================================="
echo ""
echo "Summary:"
echo "--------"
echo "• Skill usage is detected automatically from messages"
echo "• Missing environment variables return helpful setup instructions"
echo "• Instructions are specific to each skill's requirements"
echo "• Multiple skills can be checked in one message"
echo "• Skills without requirements pass through normally"
echo ""
echo "To fix missing requirements errors:"
echo "1. Add required environment variables in Railway"
echo "2. See SKILL-REQUIREMENTS-GUIDE.md for details per skill"
echo "3. Service will automatically redeploy after adding variables"
echo ""
