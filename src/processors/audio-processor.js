import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import ffmpeg from 'fluent-ffmpeg';
import fetch from 'node-fetch';
import { pipeline } from 'stream';
import { createWriteStream } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const streamPipeline = promisify(pipeline);

export class AudioProcessor {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.tempDir = config.processing.tempDir;

        this.s3Client = new S3Client({
            endpoint: `https://${config.storage.endpoint}`,
            region: config.storage.region,
            credentials: {
                accessKeyId: config.storage.accessKeyId,
                secretAccessKey: config.storage.secretAccessKey,
            },
        });
    }

    async downloadFile(url, jobId) {
        this.logger.info(`Downloading file from ${url}`);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }

        const tempFilePath = path.join(this.tempDir, `${jobId}-source`);
        await streamPipeline(response.body, createWriteStream(tempFilePath));
        return tempFilePath;
    }

    async processAudio(jobId, sourceFile, options) {
        const {
            format = 'mp3',
            quality = 'medium',
            duration,
            fade = false,
            sample_rate = 44100,
            channels = 2,
            normalize = false
        } = options;

        const outputFilename = options.filename || `${uuidv4()}.${format}`;
        const outputPath = path.join(this.tempDir, outputFilename);

        return new Promise((resolve, reject) => {
            let command = ffmpeg(sourceFile);

            // Set basic audio options
            command
                .toFormat(format)
                .audioChannels(channels)
                .audioFrequency(sample_rate);

            // Apply quality settings
            switch(quality) {
                case 'high':
                    command.audioBitrate('320k');
                    break;
                case 'medium':
                    command.audioBitrate('192k');
                    break;
                case 'low':
                    command.audioBitrate('128k');
                    break;
            }

            // If normalization is requested
            if (normalize) {
                command.audioFilters('loudnorm=I=-16:LRA=11:TP=-1.5');
            }

            // If this is a preview, apply duration limit and fades
            if (duration) {
                command.duration(duration);

                if (fade) {
                    const fadeLength = Math.min(3, duration * 0.1); // 10% of duration or 3 seconds max
                    command.audioFilters([
                        `afade=t=in:st=0:d=${fadeLength}`,
                        `afade=t=out:st=${duration-fadeLength}:d=${fadeLength}`
                    ]);
                }
            }

            command
                .on('start', commandLine => {
                    this.logger.info(`FFmpeg started with command: ${commandLine}`);
                })
                .on('progress', progress => {
                    this.logger.debug('Processing progress:', progress);
                })
                .on('end', () => {
                    this.logger.info(`Processing completed for ${outputFilename}`);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    this.logger.error(`FFmpeg error: ${err.message}`);
                    reject(err);
                })
                .save(outputPath);
        });
    }

    async generateWaveform(sourceFile, points = 100) {
        return new Promise((resolve, reject) => {
            const waveformData = [];

            ffmpeg(sourceFile)
                .toFormat('wav')
                .audioFilters(`volumedetect,astats=metadata=1:reset=1`)
                .on('stderr', line => {
                    if (line.includes('mean_volume:')) {
                        const match = line.match(/mean_volume: ([-\d.]+)/);
                        if (match) {
                            waveformData.push(Math.abs(parseFloat(match[1]) / 100));
                        }
                    }
                })
                .on('end', () => {
                    const normalized = this.normalizeWaveform(waveformData, points);
                    resolve(normalized);
                })
                .on('error', reject)
                .save('-');
        });
    }

    normalizeWaveform(data, points) {
        const max = Math.max(...data);
        const normalized = data.map(v => v / max);

        const step = normalized.length / points;
        return Array.from({length: points}, (_, i) => {
            const idx = Math.floor(i * step);
            return normalized[idx] || 0;
        });
    }

    async uploadToStorage(filePath, bucket, key) {
        this.logger.info(`Uploading ${filePath} to ${bucket}/${key}`);
        const fileStream = fs.createReadStream(filePath);

        const uploadCommand = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: fileStream,
            ACL: 'public-read',
            ContentType: this.getContentType(path.extname(filePath)),
        });

        await this.s3Client.send(uploadCommand);
        return `https://${bucket}.${this.config.storage.endpoint}/${key}`;
    }

    getContentType(extension) {
        const types = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.m4a': 'audio/mp4',
            '.ogg': 'audio/ogg',
            '.json': 'application/json'
        };
        return types[extension] || 'application/octet-stream';
    }

    async cleanup(files) {
        for (const file of files) {
            try {
                await fs.promises.unlink(file);
                this.logger.info(`Cleaned up temporary file: ${file}`);
            } catch (err) {
                this.logger.error(`Failed to cleanup file ${file}:`, err);
            }
        }
    }
}