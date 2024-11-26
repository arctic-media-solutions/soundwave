// src/workers/index.js
import { Worker } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { unlink } from 'fs/promises';
import fetch from 'node-fetch';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export function setupWorkers({ queue, logger, s3Client, concurrentJobs }) {
  logger.info('Setting up audio processing worker...', {
    redis: {
      host: config.redis.host,
      port: config.redis.port,
    }
  });

  const worker = new Worker('audio-processing', async job => {
    logger.info(`Starting to process job ${job.id}`, job.data);
    
    const { file_url, config: processingConfig } = job.data;
    const workDir = join('/tmp', uuidv4());
    
    try {
      // Create working directory
      await mkdir(workDir, { recursive: true });
      const inputPath = join(workDir, 'input.audio');
      
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

      logger.info('File downloaded successfully');
      await job.updateProgress(20);

      // Process each output format
      const outputs = [];
      const totalOutputs = processingConfig.outputs.length;
      
      for (let i = 0; i < totalOutputs; i++) {
        const output = processingConfig.outputs[i];
        logger.info(`Processing output ${i + 1}/${totalOutputs}: ${output.format}`);
        
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

          command
            .on('progress', progress => {
              const baseProgress = 20 + (i * (60 / totalOutputs));
              const outputProgress = (progress.percent / 100) * (60 / totalOutputs);
              const totalProgress = Math.min(80, Math.round(baseProgress + outputProgress));
              job.updateProgress(totalProgress);
            })
            .on('end', resolve)
            .on('error', reject)
            .save(outputPath);
        });

        // Get file info
        const fileInfo = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(outputPath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata);
          });
        });

        // Upload to storage
        const key = `${processingConfig.storage.path}/${uuidv4()}.${output.format}`;
        logger.info(`Uploading output to ${key}`);
        
        await s3Client.send(new PutObjectCommand({
          Bucket: processingConfig.storage.bucket,
          Key: key,
          Body: createReadStream(outputPath),
          ContentType: `audio/${output.format}`,
          Metadata: {
            format: output.format,
            quality: output.quality,
            duration: fileInfo.format.duration.toString(),
            sampleRate: (output.sample_rate || 44100).toString(),
            channels: (output.channels || 2).toString()
          }
        }));

        outputs.push({
          url: `https://${processingConfig.storage.bucket}.${config.storage.endpoint}/${key}`,
          format: output.format,
          duration: fileInfo.format.duration,
          size: fileInfo.format.size,
          quality: output.quality
        });

        // Clean up output file
        await unlink(outputPath);
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
            .audioFrequency(8000)
            .audioFilters('aresample=8000')
            .on('error', reject)
            .on('progress', progress => {
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
              const step = Math.ceil(normalizedPoints.length / (processingConfig.waveform.points || 1000));
              const reducedPoints = [];
              
              for (let i = 0; i < normalizedPoints.length; i += step) {
                const chunk = normalizedPoints.slice(i, i + step);
                const average = chunk.reduce((a, b) => a + b, 0) / chunk.length;
                reducedPoints.push(Number(average.toFixed(4)));
              }
              
              resolve(reducedPoints);
            })
            .save('/dev/null'); // Discard output, we only need the progress events
        });

        waveform = {
          data: waveformData,
          points: waveformData.length
        };
      }

      // Clean up input file
      await unlink(inputPath);
      
      // Try to remove work directory
      try {
        await rmdir(workDir);
      } catch (err) {
        logger.warn(`Failed to remove work directory: ${err.message}`);
      }

      logger.info(`Job ${job.id} completed successfully`);
      await job.updateProgress(100);
      
      return {
        outputs,
        waveform
      };

    } catch (error) {
      logger.error(`Job ${job.id} failed:`, error);
      
      // Clean up on error
      try {
        await unlink(join(workDir, 'input.audio'));
        await rmdir(workDir);
      } catch (err) {
        logger.warn(`Failed to clean up after error: ${err.message}`);
      }

      throw error;
    }
  }, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
      username: config.redis.username,
      password: config.redis.password,
      tls: {
        rejectUnauthorized: false
      }
    },
    concurrency: concurrentJobs,
  });

  // Add worker event handlers
  worker.on('ready', () => {
    logger.info('Worker is ready to process jobs');
  });

  worker.on('active', job => {
    logger.info(`Job ${job.id} has started processing`);
  });

  worker.on('completed', job => {
    logger.info(`Job ${job.id} has completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} has failed:`, err);
  });

  worker.on('error', err => {
    logger.error('Worker encountered an error:', err);
  });

  logger.info(`Worker setup complete. Processing up to ${concurrentJobs} jobs concurrently.`);
  return worker;
}
