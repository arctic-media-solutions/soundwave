// src/app.js
import express from 'express';
import winston from 'winston';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
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

// Redis Configuration
const redisConfig = {
  host: config.redis.host,
  port: config.redis.port,
  username: config.redis.username,
  password: config.redis.password,
  tls: {
    rejectUnauthorized: false,
  },
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  showFriendlyErrorStack: true
};

// Create Redis instance
const redis = new Redis(redisConfig);

redis.on('connect', () => {
  logger.info('Redis connected successfully');
});

redis.on('error', (err) => {
  logger.error('Redis connection error:', err);
});

// Configure processing queue with Redis configuration
const processingQueue = new Queue('audio-processing', {
  connection: redisConfig,
  defaultJobOptions: {
    removeOnComplete: false,  // Keep completed jobs
    removeOnFail: false,      // Keep failed jobs
    attempts: 3,              // Allow 3 attempts
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
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
    timestamp: new Date().toISOString(),
    redis: redis.status
  });
});

app.get('/debug/queues', async (req, res) => {
  try {
    const queueLength = await redis.llen('bull:audio-processing:wait');
    const activeJobs = await redis.llen('bull:audio-processing:active');
    const failedJobs = await redis.llen('bull:audio-processing:failed');
    const completedJobs = await redis.llen('bull:audio-processing:completed');

    res.json({
      waiting: queueLength,
      active: activeJobs,
      failed: failedJobs,
      completed: completedJobs,
      redis_status: redis.status,
      worker_status: processingQueue.worker ? 'running' : 'stopped'
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to get queue stats',
      details: err.message
    });
  }
});

// Also add this route for checking specific job details
app.get('/debug/jobs/:id', async (req, res) => {
  try {
    const jobKey = `bull:audio-processing:${req.params.id}`;
    const jobData = await redis.hgetall(jobKey);
    
    res.json({
      exists: Object.keys(jobData).length > 0,
      data: jobData
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to get job details',
      details: err.message
    });
  }
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
  concurrentJobs: config.processing.concurrentJobs,
  redisConfig
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
  await redis.quit();
  process.exit(0);
});
