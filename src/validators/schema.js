import { z } from 'zod';

// Supported formats and qualities
const SUPPORTED_FORMATS = ['mp3', 'ogg', 'wav', 'm4a'];
const SUPPORTED_QUALITIES = ['low', 'medium', 'high'];
const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

// Output configuration schema
const OutputSchema = z.object({
    format: z.enum(SUPPORTED_FORMATS),
    quality: z.enum(SUPPORTED_QUALITIES),
    sample_rate: z.number().int().min(8000).max(48000).default(44100),
    channels: z.number().int().min(1).max(2).default(2),
    filename: z.string().optional(),
    path: z.string().optional(),
    duration: z.number().positive().optional(),
    fade: z.boolean().optional(),
    normalize: z.boolean().optional()
});

// Storage configuration schema
const StorageSchema = z.object({
    bucket: z.string(),
    path: z.string()
});

// Waveform configuration schema
const WaveformSchema = z.object({
    points: z.number().int().min(100).max(10000)
});

// Notifications schema
const NotificationsSchema = z.object({
    webhook_url: z.string().url().optional(),
    error_webhook_url: z.string().url().optional(),
    progress_webhook_url: z.string().url().optional(),
    slack_webhook_url: z.string().url().optional()
}).optional();

// Audio processing options schema
const ProcessingOptionsSchema = z.object({
    normalize_audio: z.boolean().optional(),
    remove_silence: z.boolean().optional(),
    trim_silence: z.object({
        start: z.boolean(),
        end: z.boolean()
    }).optional(),
    auto_gain: z.boolean().optional(),
    id3_tags: z.object({
        title: z.string().optional(),
        artist: z.string().optional(),
        album: z.string().optional(),
        year: z.string().optional(),
        genre: z.string().optional()
    }).optional()
}).optional();

// Main job schema
export const JobSchema = z.object({
    file_url: z.string().url(),
    internal_id: z.string().optional(),
    config: z.object({
        outputs: z.array(OutputSchema).min(1).max(10),
        storage: StorageSchema,
        waveform: WaveformSchema.optional(),
        processing_options: ProcessingOptionsSchema
    }),
    notifications: NotificationsSchema,
    metadata: z.record(z.any()).optional()
});

export async function validateFileType(url) {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        const contentType = response.headers.get('content-type');
        const contentLength = response.headers.get('content-length');

        if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
            throw new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
        }

        if (!contentType?.startsWith('audio/')) {
            const extension = url.split('.').pop()?.toLowerCase();
            if (!SUPPORTED_FORMATS.includes(extension)) {
                throw new Error('Unsupported file type. Must be an audio file.');
            }
        }

        return true;
    } catch (error) {
        throw new Error(`File validation failed: ${error.message}`);
    }
}