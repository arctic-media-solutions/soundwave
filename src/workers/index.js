// src/workers/index.js
import { Worker } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import fetch from 'node-fetch';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';

export function setupWorkers({ queue, logger, s3Client, concurrentJobs }) {
  new Worker('audio-processing', async job => {
    const { file_url, config: processingConfig, webhook_url, metadata } = job.data;
    const workDir = join(config.processing.tempDir, uuidv4());
    const inputPath = join(workDir, 'input.audio');
    
    try {
      // Download file
      logger.info(`Downloading file from ${file_url}`);
      await job.updateProgress(10);
      
      const response = await fetch(file_url);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      
      await pipeline(
        response.body,
        createWriteStream(inputPath)
      );

      // Process each output format
      const outputs = [];
      for (const output of processingConfig.outputs) {
        logger.info(`Processing output: ${output.format}`);
        const outputPath = join(workDir, `output.${output.format}`);
        
        // Process audio with FFmpeg
        await new Promise((resolve, reject) => {
          let command = ffmpeg(inputPath)
            .format(output.format)
            .audioFrequency(output.sample_rate || 44100)
            .audioChannels(output.channels || 2);

          // Set quality based on configuration
          switch (output.quality) {
            case 'low':
              command.audioBitrate('96k');
              break;
            case 'medium':
              command.audioBitrate('128k');
              break;
            case 'high':
              command.audioBitrate('256k');
              break;
            default:
              command.audioBitrate('128k');
          }

          // Add fade if requested
          if (output.fade) {
            command
              .audioFilters('afade=t=in:ss=0:d=1')
              .audioFilters(`afade=t=out:st=${output.duration - 1}:d=1`);
          }

          command
            .on('progress', progress => {
              const percent = Math.min(100, Math.round(progress.percent));
              job.updateProgress(10 + (percent * 0.6)); // 10-70% progress
            })
            .on('end', resolve)
            .on('error', reject)
            .save(outputPath);
        });

        // Upload to storage
        const key = `${processingConfig.storage.path}/${uuidv4()}.${output.format}`;
        await s3Client.putObject({
          Bucket: processingConfig.storage.bucket,
          Key: key,
          Body: createReadStream(outputPath),
          ContentType: `audio/${output.format}`,
          Metadata: {
            originalUrl: file_url,
            processingConfig: JSON.stringify(output),
            ...metadata
          }
        });

        // Get file duration
        const duration = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(outputPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
          });
        });

        outputs.push({
          url: `https://${processingConfig.storage.bucket}.${config.storage.endpoint}/${key}`,
          format: output.format,
          duration,
          quality: output.quality
        });
      }

      // Generate waveform data if requested
      let waveform = null;
      if (processingConfig.waveform) {
        logger.info('Generating waveform data');
        const waveformData = await new Promise((resolve, reject) => {
          const points = [];
          let maxAmplitude = 0;
          
          ffmpeg(inputPath)
            .toFormat('wav')
            .audioChannels(1)
            .audioFrequency(8000) // Lower sample rate for waveform
            .audioFilters('aresample=8000') // Resample for consistent points
            .on('error', reject)
            .on('progress', progress => {
              // Sample amplitude data
              if (progress.frames) {
                const amplitude = Math.abs(progress.frames);
                maxAmplitude = Math.max(maxAmplitude, amplitude);
                points.push(amplitude);
              }
            })
            .on('end', () => {
              // Normalize points between 0 and 1
              const normalizedPoints = points.map(p => p / maxAmplitude);
              
              // Reduce to requested number of points
              const step = Math.ceil(normalizedPoints.length / processingConfig.waveform.points);
              const reducedPoints = [];
              
              for (let i = 0; i < normalizedPoints.length; i += step) {
                const chunk = normalizedPoints.slice(i, i + step);
                const average = chunk.reduce((a, b) => a + b, 0) / chunk.length;
                reducedPoints.push(Number(average.toFixed(4)));
              }
              
              resolve(reducedPoints);
            })
            .save('/dev/null'); // We don't need the output file
        });

        waveform = {
          data: waveformData,
          points: waveformData.length
        };
      }

      // Clean up temp files
      await unlink(inputPath);
      for (const output of outputs) {
        try {
          await unlink(join(workDir, `output.${output.format}`));
        } catch (err) {
          logger.warn(`Failed to clean up output file: ${err.message}`);
        }
      }

      // Send webhook if configured
      if (webhook_url) {
        try {
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
        } catch (err) {
          logger.error('Failed to send webhook:', err);
        }
      }

      logger.info(`Job ${job.id} completed successfully`);
      return { outputs, waveform };

    } catch (error) {
      logger.error(`Job ${job.id} failed:`, error);
      
      // Clean up on error
      try {
        await unlink(inputPath);
      } catch (err) {
        logger.warn(`Failed to clean up input file: ${err.message}`);
      }

      // Send failure webhook
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
        } catch (err) {
          logger.error('Failed to send failure webhook:', err);
        }
      }

      throw error; // Re-throw to mark job as failed
    }
  }, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
    },
    concurrency: concurrentJobs
  });

  logger.info(`Worker setup complete. Processing up to ${concurrentJobs} jobs concurrently.`);
}
