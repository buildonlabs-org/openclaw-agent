#!/bin/bash

# OpenClaw Gateway Wrapper Startup Script for Railway
# The wrapper handles all gateway configuration and lifecycle management

set -e

# Set default port if not provided by Railway
export PORT="${PORT:-8080}"
export OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-/data/workspace}"
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/data/.openclaw}"

echo "=============================================="
echo "🚀 Starting OpenClaw Gateway Wrapper"
echo "=============================================="
echo "Port: $PORT"
echo "Workspace: $OPENCLAW_WORKSPACE"
echo "State Dir: $OPENCLAW_STATE_DIR"
echo "=============================================="

# Ensure directories exist
mkdir -p "$OPENCLAW_WORKSPACE"
mkdir -p "$OPENCLAW_STATE_DIR"

# Verify OpenClaw is installed
if ! command -v openclaw &> /dev/null; then
    echo "❌ ERROR: OpenClaw CLI not found in PATH"
    echo "PATH: $PATH"
    exit 1
fi

echo "✓ OpenClaw CLI found: $(which openclaw)"
echo "✓ OpenClaw version: $(openclaw --version 2>&1 || echo 'Unable to get version')"

# Verify SETUP_PASSWORD is set
if [ -z "$SETUP_PASSWORD" ]; then
    echo "⚠️  WARNING: SETUP_PASSWORD not set!"
    echo "Set SETUP_PASSWORD in Railway Variables to access /setup wizard"
fi

# Start the wrapper server (this handles gateway lifecycle)
echo ""
echo "Starting wrapper server on port $PORT..."
cd /app
exec node src/server.js

