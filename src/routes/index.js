// src/routes/index.js
export function setupRoutes(app, { queue, logger, s3Client }) {
  // Process new audio file
  app.post('/process', async (req, res) => {
    const { file_url, config: processingConfig, webhook_url, metadata } = req.body;

    try {
      // Validate request
      if (!file_url) {
        return res.status(400).json({ error: 'file_url is required' });
      }

      // Add job to queue
      const job = await queue.add('process-audio', {
        file_url,
        config: processingConfig,
        webhook_url,
        metadata,
      }, {
        // Job options
        removeOnComplete: true, // Remove job when completed
        removeOnFail: false,    // Keep failed jobs for debugging
        attempts: 3,            // Retry up to 3 times
        backoff: {
          type: 'exponential',
          delay: 1000          // Start with 1 second delay
        }
      });

      logger.info(`Job queued: ${job.id}`, { file_url });

      res.status(202).json({
        job_id: job.id,
        status: 'queued'
      });

    } catch (err) {
      logger.error('Failed to queue job:', err);
      res.status(500).json({ error: 'Failed to queue job' });
    }
  });

  // Get job status
  app.get('/jobs/:jobId', async (req, res) => {
    try {
      const job = await queue.getJob(req.params.jobId);
      
      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const state = await job.getState();
      const progress = job.progress;

      res.json({
        job_id: job.id,
        status: state,
        progress,
        ...(job.returnvalue || {}),
        error: job.failedReason
      });

    } catch (err) {
      logger.error('Failed to get job status:', err);
      res.status(500).json({ error: 'Failed to get job status' });
    }
  });
}
