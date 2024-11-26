// src/config/index.js
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'API_KEYS',
  'STORAGE_ENDPOINT',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'STORAGE_BUCKET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  
  auth: {
    apiKeys: process.env.API_KEYS.split(','),
  },
  
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION || 'nyc3',
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
    bucket: process.env.STORAGE_BUCKET,
  },
  
  processing: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '300000000', 10), // 300MB default
    maxDuration: parseInt(process.env.MAX_DURATION || '3600', 10), // 1 hour default
    concurrentJobs: parseInt(process.env.CONCURRENT_JOBS || '2', 10),
    ffmpegPath: process.env.FFMPEG_PATH || '/usr/bin/ffmpeg',
    tempDir: process.env.TEMP_DIR || '/tmp',
  },
};
