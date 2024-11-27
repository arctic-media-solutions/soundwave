# Build stage
FROM node:18-slim as builder

# Install only the needed dependencies for building
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Production stage
FROM node:18-slim

# Install FFmpeg and cleanup in single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create app directory
WORKDIR /usr/src/app

# Create non-root user for security
RUN groupadd -r soundwave && useradd -r -g soundwave soundwave

# Create and set permissions for temp directory
RUN mkdir -p /tmp/soundwave && chown soundwave:soundwave /tmp/soundwave

# Copy built node_modules and source from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app ./

# Set ownership
RUN chown -R soundwave:soundwave /usr/src/app

# Switch to non-root user
USER soundwave

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    TEMP_DIR=/tmp/soundwave

# Start the service
CMD ["node", "src/app.js"]