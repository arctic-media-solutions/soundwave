import { Worker } from 'bullmq';
import fetch from 'node-fetch';
import { AudioProcessor } from '../processors/audio-processor.js';
import { v4 as uuidv4 } from 'uuid';

export function setupWorkers({ queue, logger, s3Client, concurrentJobs, config }) {  // Added config here
  const processor = new AudioProcessor(config, logger);  // Now config is available

  const worker = new Worker('audio-processing', async job => {
    const { file_url, config: processingConfig, webhook_url, metadata } = job.data;
    const files = [];  // Track files for cleanup

    try {
      // Download file
      await job.updateProgress(10);
      logger.info(`Downloading file for job ${job.id}`);
      const sourceFile = await processor.downloadFile(file_url, job.id);
      files.push(sourceFile);

      // Process each output format
      await job.updateProgress(20);
      const outputs = [];
      for (const output of processingConfig.outputs) {
        const processedFile = await processor.processAudio(
            job.id,
            sourceFile,
            output.format,
            output.quality
        );
        files.push(processedFile);

        // Upload to storage
        const key = `${processingConfig.storage.path}/${uuidv4()}.${output.format}`;
        const url = await processor.uploadToStorage(
            processedFile,
            processingConfig.storage.bucket,
            key
        );

        outputs.push({
          url,
          format: output.format,
          quality: output.quality
        });
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

      // Send webhook if provided
      if (webhook_url) {
        await fetch(webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: job.id,
            status: 'completed',
            outputs,
            waveform,
            metadata
          })
        });
      }

      await job.updateProgress(100);

      return {
        status: 'completed',
        outputs,
        waveform,
        metadata
      };

    } catch (error) {
      logger.error(`Job ${job.id} failed:`, error);

      // Try to notify webhook of failure
      if (webhook_url) {
        try {
          await fetch(webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              job_id: job.id,
              status: 'failed',
              error: error.message,
              metadata
            })
          });
        } catch (webhookError) {
          logger.error(`Failed to send failure webhook for job ${job.id}:`, webhookError);
        }
      }

      throw error;

    } finally {
      // Cleanup temporary files
      await processor.cleanup(files);
    }
  }, {
    connection: config.redis  // Use the redis config directly
  });

  // Log worker events
  worker.on('completed', job => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed:`, err);
  });

  logger.info(`Worker setup complete. Processing up to ${concurrentJobs} jobs concurrently.`);
}