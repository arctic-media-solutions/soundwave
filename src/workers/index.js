import { Worker } from 'bullmq';
import fetch from 'node-fetch';
import { AudioProcessor } from '../processors/audio-processor.js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export function setupWorkers({ queue, logger, s3Client, concurrentJobs, config }) {
  const processor = new AudioProcessor(config, logger);

  const worker = new Worker('audio-processing', async job => {
    const { file_url, config: processingConfig, webhook_url, metadata } = job.data;
    const files = [];

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
        logger.info(`Processing output format: ${output.format}`, { output });

        // Generate UUID for filename
        const filename = `${uuidv4()}.${output.format}`;
        const processedFile = await processor.processAudio(
            job.id,
            sourceFile,
            output
        );
        files.push(processedFile);

        // Upload to storage
        const storagePath = processingConfig.storage.path || 'audio';
        const key = path.join(storagePath, filename).replace(/\\/g, '/');

        logger.info(`Uploading to ${processingConfig.storage.bucket}/${key}`);

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

      await job.updateProgress(100);

      const response = {
        status: 'completed',
        outputs,
        waveform,
        metadata
      };

      // Send webhook if provided
      if (webhook_url) {
        await fetch(webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_id: job.id,
            ...response
          })
        });
      }

      return response;

    } catch (error) {
      logger.error('Processing error:', error);
      throw error;
    } finally {
      await processor.cleanup(files);
    }
  }, {
    connection: config.redis
  });

  worker.on('completed', job => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed:`, err);
  });

  logger.info(`Worker setup complete. Processing up to ${concurrentJobs} jobs concurrently.`);
}