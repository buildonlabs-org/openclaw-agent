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
# Set environment variables to skip ALL interactive prompts
ENV OPENCLAW_SKIP_SETUP=1 \
    OPENCLAW_SKIP_ONBOARDING=1 \
    OPENCLAW_NO_TELEMETRY=1 \
    DEBIAN_FRONTEND=noninteractive \
    CI=true

# Install OpenClaw - ignore exit code from interactive setup failing
# The install itself succeeds, just the post-install setup fails in Docker
RUN curl -fsSL https://openclaw.ai/install.sh | bash || echo "Install script exit code: $? (expected if tty setup fails)"

# Install ClawHub CLI for skill management
RUN npm install -g clawhub

# Verify ClawHub works
RUN clawhub --cli-version

# Cache bust for skill installation - change this value to force rebuild
ARG SKILL_CACHE_VERSION=v8
RUN echo "Skill cache version: $SKILL_CACHE_VERSION"

# Accept ADDITIONAL_SKILLS from Railway environment variable
# Frontend sets this via Railway API before triggering redeploy
# Format: space-separated skill names (e.g., "twitter telegram weather")
ARG ADDITIONAL_SKILLS=""

# Pre-install all skills to /opt/skills-cache during build
# Common skills + ADDITIONAL_SKILLS from Railway env var
# Add 2-second delays between installs to respect ClawHub rate limits
RUN mkdir -p /opt/skills-cache && \
    echo "=== Skill Installation to /opt/skills-cache ===" && \
    echo "Common skills: duckduckgo-search polymarket-odds hyperliquid-cli onchain" && \
    echo "Additional skills: ${ADDITIONAL_SKILLS:-none}" && \
    echo "" && \
    clawhub install duckduckgo-search --workdir /opt/skills-cache --no-input || echo "⚠ Failed: duckduckgo-search" && sleep 2 && \
    clawhub install polymarket-odds --workdir /opt/skills-cache --no-input || echo "⚠ Failed: polymarket-odds" && sleep 2 && \
    clawhub install hyperliquid-cli --workdir /opt/skills-cache --no-input || echo "⚠ Failed: hyperliquid-cli" && sleep 2 && \
    clawhub install onchain --workdir /opt/skills-cache --no-input || echo "⚠ Failed: onchain" && sleep 2 && \
    if [ -n "$ADDITIONAL_SKILLS" ]; then \
        echo "Installing additional skills..." && \
        for skill in $ADDITIONAL_SKILLS; do \
            skill=$(echo "$skill" | xargs) && \
            if [ -n "$skill" ]; then \
                echo "  → Installing: $skill" && \
                clawhub install "$skill" --workdir /opt/skills-cache --no-input || echo "  ⚠ Failed: $skill" && \
                sleep 2; \
            fi; \
        done; \
    fi && \
    echo "" && \
    echo "✓ Skill cache setup complete" && \
    echo "Installed skills:" && \
    ls -la /opt/skills-cache/skills 2>/dev/null || echo "(no skills directory)" && \
    du -sh /opt/skills-cache 2>/dev/null || true

# Add OpenClaw to PATH
ENV PATH="/root/.local/bin:/root/.openclaw/bin:${PATH}"

# Find where OpenClaw actually installed and set OPENCLAW_ENTRY
RUN which openclaw || (echo "OpenClaw not found in PATH" && find /root -name openclaw -type f 2>/dev/null) && \
    OPENCLAW_BIN=$(which openclaw || find /root/.local/bin -name openclaw 2>/dev/null | head -1) && \
    echo "OpenClaw binary at: $OPENCLAW_BIN" && \
    ls -la "$OPENCLAW_BIN" || true

# Verify OpenClaw works
RUN openclaw --version || (echo "ERROR: openclaw command not working" && exit 1)

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
