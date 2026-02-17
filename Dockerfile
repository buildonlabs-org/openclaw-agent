# OpenClaw Gateway on Railway
# This Dockerfile creates a minimal container for running the OpenClaw gateway

FROM node:20-alpine

# Install dependencies for OpenClaw
RUN apk add --no-cache \
    curl \
    bash \
    ca-certificates

# Install OpenClaw CLI
RUN curl -fsSL https://openclaw.ai/install.sh | bash

# Add OpenClaw binary to PATH (typically installed to ~/.local/bin)
ENV PATH="/root/.local/bin:${PATH}"

# Create workspace directory
RUN mkdir -p /data/workspace

# Set default workspace location
ENV OPENCLAW_WORKSPACE=/data/workspace

# Copy runtime files
COPY start.sh /start.sh
COPY health.js /health.js

# Make start script executable
RUN chmod +x /start.sh

# Expose port (Railway will override with PORT env var)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run the startup script
ENTRYPOINT ["/start.sh"]
