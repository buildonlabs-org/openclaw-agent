#!/bin/bash

# Test script for new OpenClaw API endpoints
# Bearer token: f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659

API_KEY="f5e9455973532f155119f87b2140461f62deb532b3ad85748b55c5369681c659"
BASE_URL="http://localhost:8080"

echo "========================================="
echo "Testing OpenClaw API Endpoints"
echo "========================================="
echo ""

echo "1. GET /api/channels - Channel Status"
echo "---------------------------------------"
curl -s -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/channels" | jq
echo ""
echo ""

echo "2. GET /api/models - List Models"
echo "---------------------------------------"
curl -s -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/models" | jq
echo ""
echo ""

echo "3. GET /api/config - Get Configuration"
echo "---------------------------------------"
echo "Get gateway.port:"
curl -s -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/config?path=gateway.port" | jq
echo ""
echo "Get aiProvider:"
curl -s -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/config?path=aiProvider" | jq
echo ""
echo ""

echo "4. GET /api/sessions - List Sessions"
echo "---------------------------------------"
curl -s -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/sessions" | jq
echo ""
echo ""

echo "5. GET /api/status - Agent Status (existing)"
echo "---------------------------------------"
curl -s -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/status" | jq
echo ""
echo ""

echo "========================================="
echo "All tests complete!"
echo "========================================="
