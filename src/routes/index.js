import { Job } from 'bullmq';
import { JobSchema, validateFileType } from '../validators/schema.js';
import { z } from 'zod';

export function setupRoutes(app, { queue, logger, s3Client }) {
  // Process new audio file
  app.post('/process', async (req, res) => {
    try {
      // Validate request body against schema
      const validatedData = JobSchema.parse(req.body);

      // Validate file type and size
      try {
        await validateFileType(validatedData.file_url);
      } catch (error) {
        return res.status(400).json({
          error: 'File validation failed',
          details: error.message
        });
      }

      logger.info('Queueing new job', {
        file_url: validatedData.file_url,
        internal_id: validatedData.internal_id
      });

      const job = await queue.add('process-audio', validatedData, {
        removeOnComplete: false,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      });

      logger.info(`Job queued successfully: ${job.id}`);

      res.status(202).json({
        job_id: job.id,
        status: 'queued',
        message: 'Processing started',
        config: validatedData.config
      });

    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        });
      }

      logger.error('Failed to queue job:', err);
      res.status(500).json({
        error: 'Failed to queue job',
        message: err.message
      });
    }
  });

  // Get job status
  app.get('/jobs/:jobId', async (req, res) => {
    try {
      const job = await queue.getJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
          job_id: req.params.jobId
        });
      }

      const state = await job.getState();
      const progress = job.progress;
      const failedReason = job.failedReason;

      res.json({
        job_id: job.id,
        internal_id: job.data.internal_id,
        status: state,
        progress,
        data: job.data,
        result: job.returnvalue,
        error: failedReason,
        timestamp: job.timestamp,
        attempts: job.attemptsMade,
        finishedOn: job.finishedOn
      });
    } catch (err) {
      logger.error('Failed to get job status:', err);
      res.status(500).json({
        error: 'Failed to get job status',
        message: err.message
      });
    }
  });

  // Get job logs
  app.get('/jobs/:jobId/logs', async (req, res) => {
    try {
      const job = await queue.getJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
          job_id: req.params.jobId
        });
      }

      // Get all job events
      const events = await job.getState();
      const logs = [
        { timestamp: job.timestamp, event: 'created' },
        { timestamp: job.processedOn, event: 'started' },
        { timestamp: job.finishedOn, event: 'finished', state: events }
      ].filter(log => log.timestamp);

      if (job.failedReason) {
        logs.push({
          timestamp: job.finishedOn,
          event: 'error',
          error: job.failedReason,
          attempts: job.attemptsMade
        });
      }

      res.json({
        job_id: job.id,
        internal_id: job.data.internal_id,
        logs: logs.sort((a, b) => a.timestamp - b.timestamp)
      });
    } catch (err) {
      logger.error('Failed to get job logs:', err);
      res.status(500).json({
        error: 'Failed to get job logs',
        message: err.message
      });
    }
  });

  // Get all processing stats
  app.get('/stats', async (req, res) => {
    try {
      const [
        waiting,
        active,
        completed,
        failed,
        delayed
      ] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount()
      ]);

      // Get jobs completed in last 24 hours
      const completedJobs = await queue.getJobs(['completed'], 0, -1);
      const last24Hours = completedJobs.filter(job =>
          job.finishedOn > Date.now() - 24 * 60 * 60 * 1000
      ).length;

      res.json({
        current: {
          waiting,
          active,
          delayed
        },
        total: {
          completed,
          failed
        },
        last24Hours,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logger.error('Failed to get stats:', err);
      res.status(500).json({
        error: 'Failed to get stats',
        message: err.message
      });
    }
  });

  // Cancel/delete a job
  app.delete('/jobs/:jobId', async (req, res) => {
    try {
      const job = await queue.getJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
          job_id: req.params.jobId
        });
      }

      const jobState = await job.getState();

      // If job is active, we need to stop it
      if (jobState === 'active') {
        // Optionally: implement job stopping logic
        logger.warn(`Attempting to stop active job ${job.id}`);
      }

      await job.remove();
      logger.info(`Job ${job.id} cancelled`, { internal_id: job.data.internal_id });

      res.json({
        job_id: job.id,
        internal_id: job.data.internal_id,
        status: 'cancelled',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logger.error('Failed to cancel job:', err);
      res.status(500).json({
        error: 'Failed to cancel job',
        message: err.message
      });
    }
  });

  // Retry a failed job
  app.post('/jobs/:jobId/retry', async (req, res) => {
    try {
      const job = await queue.getJob(req.params.jobId);
      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
          job_id: req.params.jobId
        });
      }

      const state = await job.getState();
      if (state !== 'failed') {
        return res.status(400).json({
          error: 'Only failed jobs can be retried',
          job_id: req.params.jobId,
          current_state: state
        });
      }

      await job.retry();
      logger.info(`Job ${job.id} queued for retry`, { internal_id: job.data.internal_id });

      res.json({
        job_id: job.id,
        internal_id: job.data.internal_id,
        status: 'retry_queued',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logger.error('Failed to retry job:', err);
      res.status(500).json({
        error: 'Failed to retry job',
        message: err.message
      });
    }
  });

  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      // Check Redis connection
      const redisOk = queue.client && await queue.client.ping() === 'PONG';

      // Check if worker is running
      const activeWorkers = await queue.getWorkers();
      const workerOk = activeWorkers.length > 0;

      const status = redisOk && workerOk ? 'healthy' : 'unhealthy';

      res.json({
        status,
        timestamp: new Date().toISOString(),
        details: {
          redis: redisOk ? 'connected' : 'disconnected',
          worker: workerOk ? 'running' : 'stopped',
          queue: {
            name: queue.name,
            active: await queue.getActiveCount(),
            waiting: await queue.getWaitingCount()
          }
        }
      });
    } catch (err) {
      logger.error('Health check failed:', err);
      res.status(503).json({
        status: 'unhealthy',
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });
}