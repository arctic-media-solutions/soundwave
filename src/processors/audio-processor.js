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
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download file: ${response.statusText}`);
        }

        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > this.config.processing.maxFileSize) {
            throw new Error('File size exceeds maximum allowed size');
        }

        const tempFilePath = path.join(this.tempDir, `${jobId}-source`);
        await streamPipeline(response.body, createWriteStream(tempFilePath));
        return tempFilePath;
    }

    async processAudio(jobId, sourceFile, format, quality) {
        const outputPath = path.join(this.tempDir, `${jobId}-output.${format}`);

        return new Promise((resolve, reject) => {
            let command = ffmpeg(sourceFile)
                .toFormat(format);

            // Apply quality settings
            switch(quality) {
                case 'high':
                    if (format === 'mp3') {
                        command.audioBitrate(320);
                    }
                    break;
                case 'medium':
                    if (format === 'mp3') {
                        command.audioBitrate(192);
                    }
                    break;
                case 'low':
                    if (format === 'mp3') {
                        command.audioBitrate(128);
                    }
                    break;
            }

            command
                .on('end', () => resolve(outputPath))
                .on('error', (err) => reject(err))
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
                    // Parse FFmpeg output to extract volume data
                    if (line.includes('mean_volume:')) {
                        const match = line.match(/mean_volume: ([-\d.]+)/);
                        if (match) {
                            waveformData.push(Math.abs(parseFloat(match[1]) / 100));
                        }
                    }
                })
                .on('end', () => {
                    // Normalize and reduce points to requested size
                    const normalized = this.normalizeWaveform(waveformData, points);
                    resolve(normalized);
                })
                .on('error', reject)
                .save('-');  // Output to null since we only need the stats
        });
    }

    normalizeWaveform(data, points) {
        // Normalize waveform data to 0-1 range and requested number of points
        const max = Math.max(...data);
        const normalized = data.map(v => v / max);

        // Reduce to requested number of points
        const step = normalized.length / points;
        return Array.from({length: points}, (_, i) => {
            const idx = Math.floor(i * step);
            return normalized[idx] || 0;
        });
    }

    async uploadToStorage(filePath, bucket, key) {
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
            } catch (err) {
                this.logger.error(`Failed to cleanup file ${file}:`, err);
            }
        }
    }
}