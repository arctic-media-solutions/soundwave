import { Worker } from 'bullmq';
import fetch from 'node-fetch';
import { AudioProcessor } from '../processors/audio-processor.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export function setupWorkers({ queue, logger, s3Client, concurrentJobs, config }) {
  const processor = new AudioProcessor(config, logger);

  async function sendWebhook(url, data) {
    try {
      logger.info(`Sending webhook to ${url}`, { jobId: data.job_id });
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`Webhook failed with status ${response.status}`);
      }

      logger.info(`Webhook sent successfully to ${url}`, { jobId: data.job_id });
      return true;
    } catch (error) {
      logger.error(`Webhook failed for ${url}:`, error);
      return false;
    }
  }

  const worker = new Worker('audio-processing', async job => {
    const { file_url, internal_id, config: processingConfig, webhook_url, metadata } = job.data;
    const files = [];

    try {
      // Download file
      await job.updateProgress(10);
      logger.info(`Downloading file for job ${job.id}`, { internal_id });
      const sourceFile = await processor.downloadFile(file_url, job.id);
      files.push(sourceFile);

      // Send initial webhook if provided
      if (webhook_url) {
        await sendWebhook(webhook_url, {
          job_id: job.id,
          internal_id,
          status: 'processing',
          progress: 10,
          message: 'Download complete'
        });
      }

      // Process each output format
      await job.updateProgress(20);
      const outputs = [];

      for (const output of processingConfig.outputs) {
        logger.info(`Processing output format: ${output.format}`, { internal_id, output });

        const processedFile = await processor.processAudio(
            job.id,
            sourceFile,
            output
        );
        files.push(processedFile);

        // Use custom path if provided, fallback to global path
        const storagePath = output.path || processingConfig.storage.path || 'audio';
        const filename = output.filename || `${uuidv4()}.${output.format}`;
        const key = path.join(storagePath, filename).replace(/\\/g, '/');

        logger.info(`Uploading to ${processingConfig.storage.bucket}/${key}`, { internal_id });

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
          type: output.duration ? 'preview' : 'full'
        });

        // Send progress webhook
        if (webhook_url) {
          await sendWebhook(webhook_url, {
            job_id: job.id,
            internal_id,
            status: 'processing',
            progress: 50 + (outputs.length / processingConfig.outputs.length) * 30,
            message: `Processed ${filename}`,
            current_output: {
              filename,
              format: output.format,
              type: output.duration ? 'preview' : 'full'
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

        if (webhook_url) {
          await sendWebhook(webhook_url, {
            job_id: job.id,
            internal_id,
            status: 'processing',
            progress: 90,
            message: 'Generated waveform data'
          });
        }
      }

      await job.updateProgress(100);

      const response = {
        job_id: job.id,
        internal_id,
        status: 'completed',
        outputs,
        waveform,
        metadata
      };

      // Send completion webhook
      if (webhook_url) {
        await sendWebhook(webhook_url, response);
      }

      return response;

    } catch (error) {
      logger.error('Processing error:', { error, internal_id });

      // Send failure webhook
      if (webhook_url) {
        await sendWebhook(webhook_url, {
          job_id: job.id,
          internal_id,
          status: 'failed',
          error: error.message,
          metadata
        });
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

  worker.on('error', err => {
    logger.error('Worker error:', err);
  });

  logger.info(`Worker setup complete. Processing up to ${concurrentJobs} jobs concurrently.`);

  return worker;
}