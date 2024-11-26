import { Worker } from 'bullmq';
import fetch from 'node-fetch';
import { AudioProcessor } from '../processors/audio-processor.js';
import { v4 as uuidv4 } from 'uuid';

export function setupWorkers({ queue, logger, s3Client, concurrentJobs, config }) {
  const processor = new AudioProcessor(config, logger);

  const worker = new Worker('audio-processing', async job => {
    const {
      file_url,
      config: processingConfig,
      webhook_url,
      progress_webhook_url,
      internal_id,
      metadata
    } = job.data;

    const files = [];

    try {
      // Download file
      await job.updateProgress(10);
      logger.info(`Downloading file for job ${job.id}`, { internal_id });
      const sourceFile = await processor.downloadFile(file_url, job.id);
      files.push(sourceFile);

      // Send progress webhook if provided
      if (progress_webhook_url) {
        await sendProgressWebhook(progress_webhook_url, {
          job_id: job.id,
          internal_id,
          status: 'processing',
          progress: 10,
          stage: 'download_complete'
        });
      }

      // Process each output format
      await job.updateProgress(20);
      const outputs = [];

      for (const output of processingConfig.outputs) {
        logger.info(`Processing output format: ${output.format}`, { internal_id, output });

        // Determine storage path for this output
        const storagePath = output.path || processingConfig.storage.path || '';

        // Determine filename
        const filename = output.filename ||
            (output.prefix ? `${output.prefix}-${uuidv4()}.${output.format}` : `${uuidv4()}.${output.format}`);

        const processedFile = await processor.processAudio(
            job.id,
            sourceFile,
            {
              format: output.format,
              quality: output.quality,
              duration: output.duration,
              fade: output.fade,
              prefix: output.prefix,
              sample_rate: output.sample_rate,
              channels: output.channels,
              normalize: output.normalize,
              startTime: output.startTime,
              filename
            }
        );
        files.push(processedFile);

        const key = path.join(storagePath, filename).replace(/\\/g, '/');

        const url = await processor.uploadToStorage(
            processedFile,
            processingConfig.storage.bucket,
            key
        );

        outputs.push({
          url,
          key,
          filename,
          format: output.format,
          quality: output.quality,
          duration: output.duration,
          type: output.prefix === 'preview' ? 'preview' : 'full',
          metadata: output.metadata || {}
        });

        // Send progress webhook for each output
        if (progress_webhook_url) {
          await sendProgressWebhook(progress_webhook_url, {
            job_id: job.id,
            internal_id,
            status: 'processing',
            progress: 50 + (outputs.length / processingConfig.outputs.length) * 30,
            stage: 'output_complete',
            output_details: {
              format: output.format,
              type: output.prefix === 'preview' ? 'preview' : 'full'
            }
          });
        }
      }

      // Generate waveform if requested
      let waveform = null;
      if (processingConfig.waveform) {
        await job.updateProgress(80);
        waveform = await processor.generateWaveform(
            sourceFile,
            processingConfig.waveform.points
        );
      }

      const response = {
        job_id: job.id,
        internal_id,
        status: 'completed',
        outputs,
        waveform,
        metadata
      };

      // Send completion webhook if provided
      if (webhook_url) {
        await fetch(webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(response)
        });
      }

      await job.updateProgress(100);
      return response;

    } catch (error) {
      logger.error(`Job ${job.id} failed:`, { error, internal_id });

      const errorResponse = {
        job_id: job.id,
        internal_id,
        status: 'failed',
        error: error.message,
        metadata
      };

      if (webhook_url) {
        try {
          await fetch(webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(errorResponse)
          });
        } catch (webhookError) {
          logger.error(`Failed to send failure webhook for job ${job.id}:`, webhookError);
        }
      }

      throw error;

    } finally {
      await processor.cleanup(files);
    }
  }, {
    connection: config.redis,
    concurrency: concurrentJobs
  });

  worker.on('completed', job => {
    logger.info(`Job ${job.id} completed successfully`, { internal_id: job.data.internal_id });
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed:`, { error: err, internal_id: job.data.internal_id });
  });

  logger.info(`Worker setup complete. Processing up to ${concurrentJobs} jobs concurrently.`);
}

async function sendProgressWebhook(url, data) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch (error) {
    logger.error('Failed to send progress webhook:', error);
  }
}