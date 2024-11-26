// src/routes/index.js
export function setupRoutes(app, { queue, logger, s3Client }) {
  // Process new audio file
  app.post('/process', async (req, res) => {
    const { file_url, config: processingConfig, webhook_url, metadata } = req.body;
    
    try {
      // Validate request
      if (!file_url) {
        logger.error('Missing file_url in request');
        return res.status(400).json({ error: 'file_url is required' });
      }

      if (!processingConfig?.outputs || !processingConfig.outputs.length) {
        logger.error('Missing outputs configuration');
        return res.status(400).json({ error: 'outputs configuration is required' });
      }

      if (!processingConfig?.storage?.bucket) {
        logger.error('Missing storage configuration');
        return res.status(400).json({ error: 'storage configuration is required' });
      }

      logger.info('Queueing new job', { file_url });

      // Add job to queue
      const job = await queue.add('process-audio', {
        file_url,
        config: processingConfig,
        webhook_url,
        metadata,
      }, {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        }
      });

      logger.info(`Job queued successfully: ${job.id}`);

      // Send immediate response
      res.status(202).json({
        job_id: job.id,
        status: 'queued',
        message: 'Processing started'
      });

    } catch (err) {
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
        return res.status(404).json({ error: 'Job not found' });
      }

      const state = await job.getState();
      const progress = job.progress;

      logger.info(`Job ${job.id} status requested:`, { state, progress });

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
