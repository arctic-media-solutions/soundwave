# Use Node.js base image
FROM node:18-slim

# Install FFmpeg and dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y ffmpeg

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source
COPY . .

# Create temp directory for processing
RUN mkdir -p /tmp/soundwave && chmod 777 /tmp/soundwave

# Expose port
EXPOSE 3000

# Start the service
CMD ["npm", "start"]
