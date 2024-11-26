// src/config/index.js
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
  
  auth: {
    apiKeys: (process.env.API_KEYS || '').split(','),
  },
  
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '25061', 10),
    username: process.env.REDIS_USERNAME || 'default',
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
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '300000000', 10),
    maxDuration: parseInt(process.env.MAX_DURATION || '3600', 10),
    concurrentJobs: parseInt(process.env.CONCURRENT_JOBS || '2', 10),
  },
};

// Validate required environment variables
const requiredVars = [
  'API_KEYS',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'STORAGE_ENDPOINT',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'STORAGE_BUCKET'
];

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    throw new Error(`Missing required environment variable: ${varName}`);
  }
}
