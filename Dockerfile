# OpenClaw Gateway on Railway
# This Dockerfile creates a minimal container for running the OpenClaw gateway

FROM node:22-slim

# Install dependencies for OpenClaw
RUN apt-get update && apt-get install -y \
    curl \
    bash \
    ca-certificates \
    git \
    build-essential \
    python3 \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Install OpenClaw CLI using the official installer
ENV OPENCLAW_SKIP_SETUP=1 \
    DEBIAN_FRONTEND=noninteractive \
    CI=true

RUN curl -fsSL https://openclaw.ai/install.sh | bash

# Add OpenClaw to PATH
ENV PATH="/root/.local/bin:/root/.openclaw/bin:${PATH}"

# Find where OpenClaw actually installed and set OPENCLAW_ENTRY
RUN which openclaw && \
    OPENCLAW_BIN=$(which openclaw) && \
    echo "OpenClaw binary at: $OPENCLAW_BIN" && \
    ls -la "$OPENCLAW_BIN" && \
    # Check if it's a symlink and follow it
    if [ -L "$OPENCLAW_BIN" ]; then \
      REAL_PATH=$(readlink -f "$OPENCLAW_BIN"); \
      echo "Real path: $REAL_PATH"; \
      OPENCLAW_DIR=$(dirname "$REAL_PATH"); \
    else \
      OPENCLAW_DIR=$(dirname "$OPENCLAW_BIN"); \
    fi && \
    echo "OpenClaw directory: $OPENCLAW_DIR" && \
    ls -la "$OPENCLAW_DIR" || true

# Verify OpenClaw works
RUN openclaw --version

# Create workspace directory
RUN mkdir -p /data/workspace /data/.openclaw

# Set default workspace location
ENV OPENCLAW_WORKSPACE=/data/workspace
ENV OPENCLAW_STATE_DIR=/data/.openclaw
# Use openclaw CLI binary directly
ENV OPENCLAW_CLI=openclaw

# Set up Node wrapper application
WORKDIR /app

# Copy package files
COPY package.json /app/

# Install Node dependencies for wrapper
RUN npm install --production

# Copy wrapper source code
COPY src/ /app/src/

# Copy legacy health.js (backward compatibility)
COPY health.js /health.js

# Copy start script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Expose port (Railway will override with PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run the startup script
ENTRYPOINT ["/start.sh"]
