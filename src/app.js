// src/app.js
import express from 'express';
import winston from 'winston';
import { Queue } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { config } from './config/index.js';
import { setupRoutes } from './routes/index.js';
import { setupWorkers } from './workers/index.js';

// Configure logging
const logger = winston.createLogger({
  level: config.server.env === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Configure S3/Spaces client
const s3Client = new S3Client({
  endpoint: `https://${config.storage.endpoint}`,
  region: config.storage.region,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
});

// Configure processing queue with DO Redis configuration
const processingQueue = new Queue('audio-processing', {
  connection: {
    host: config.redis.host,
    port: config.redis.port,
    username: config.redis.username,
    password: config.redis.password,
    tls: {
      rejectUnauthorized: false // Required for DO managed Redis
    }
  },
});

// Monitor Redis connection
processingQueue.on('error', (error) => {
  logger.error('Redis Queue Error:', error);
});

processingQueue.on('connected', () => {
  logger.info('Redis Queue Connected');
});

processingQueue.on('disconnected', () => {
  logger.warn('Redis Queue Disconnected');
});

// Create express app
const app = express();

// Middleware
app.use(express.json());

// Basic logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    version: process.env.npm_package_version,
    timestamp: new Date().toISOString()
  });
});

// API Key authentication middleware
app.use((req, res, next) => {
  const apiKey = req.header('X-API-Key');
  if (!apiKey || !config.auth.apiKeys.includes(apiKey)) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
});

// Setup routes
setupRoutes(app, { queue: processingQueue, logger, s3Client });

// Setup workers
setupWorkers({ 
  queue: processingQueue, 
  logger, 
  s3Client,
  concurrentJobs: config.processing.concurrentJobs
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: config.server.env === 'development' ? err.message : undefined
  });
});

// Start server
const port = config.server.port || 3000;
app.listen(port, () => {
  logger.info(`🎵 Soundwave service listening on port ${port}`);
  logger.info(`Environment: ${config.server.env}`);
});

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  await processingQueue.close();
  process.exit(0);
});
