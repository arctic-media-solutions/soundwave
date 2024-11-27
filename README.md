# 🎵 Soundwave

A dedicated audio processing microservice that turns raw audio into streaming-ready formats. Similar to Coconut.co, but specialized for audio processing with advanced features like waveform generation and preview clips.

## Table of Contents
- [Features](#features)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Technical Details](#technical-details)
- [Environment Configuration](#environment-configuration)
- [Deployment](#deployment)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Features

### Audio Processing
- **Multiple Output Formats**
  - MP3 (320kbps, 192kbps, 128kbps)
  - OGG, WAV, M4A support
  - Custom sample rates (8kHz - 48kHz)
  - Stereo/Mono conversion

- **Audio Enhancement**
  - Volume normalization (-16 LUFS target)
  - Automatic gain control
  - Silence removal
  - Custom fade in/out

- **Preview Generation**
  - Custom duration clips
  - Smart fade effects
  - Configurable start points

### Storage & Delivery
- Digital Ocean Spaces integration
- Custom file paths and names
- Public/private file access
- Organized folder structures

### Processing Features
- Waveform data generation
- Progress tracking
- Webhook notifications
- Metadata handling

## Quick Start

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/soundwave.git

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Start service
npm start
```

### Basic Usage Example

```bash
curl -X POST https://your-api-endpoint/process \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "file_url": "https://example.com/audio.wav",
    "internal_id": "model_123",
    "webhook_url": "https://your-webhook.com/callback",
    "config": {
      "outputs": [
        {
          "format": "mp3",
          "quality": "high",
          "filename": "full.mp3",
          "path": "model_123/full"
        },
        {
          "format": "mp3",
          "quality": "medium",
          "duration": 20,
          "fade": true,
          "filename": "preview.mp3",
          "path": "model_123/preview"
        }
      ],
      "storage": {
        "bucket": "your-bucket",
        "path": "audio/model_123"
      },
      "waveform": {
        "points": 1000
      }
    }
  }'
```

## Technical Details

### Audio Processing Specifications

#### Quality Levels
- **High Quality**
  - Bitrate: 320kbps
  - Sample Rate: 48kHz
  - Channels: Stereo
  - Normalization: -16 LUFS

- **Medium Quality**
  - Bitrate: 192kbps
  - Sample Rate: 44.1kHz
  - Channels: Stereo
  - Normalization: -16 LUFS

- **Low Quality**
  - Bitrate: 128kbps
  - Sample Rate: 44.1kHz
  - Channels: Stereo/Mono
  - Normalization: -16 LUFS

#### Preview Generation
- Default fade duration: 10% of clip length (max 3 seconds)
- Fade curve: Logarithmic
- Volume normalization applied before fade

#### Waveform Generation
- Resolution: 100-10000 points
- Normalized amplitude values (0-1)
- RMS-based measurement
- 100ms window size

### System Limitations
- Maximum file size: 300MB
- Maximum audio duration: 1 hour
- Concurrent jobs: Configurable (default 2)
- Supported input formats: MP3, WAV, M4A, OGG
- Temp storage: Cleaned after processing

## API Reference

### Submit Processing Job

```bash
POST /process
```

#### Required Headers
```
X-API-Key: your-api-key
Content-Type: application/json
```

#### Request Body Schema
```typescript
{
    // Required
    file_url: string,          // Source audio URL
    config: {
        outputs: [{            // At least one output required
            format: string,    // mp3, ogg, wav, m4a
            quality: string,   // high, medium, low
            sample_rate?: number,  // 8000-48000
            channels?: number, // 1 or 2
            filename?: string, // Custom filename
            path?: string,     // Custom path
            duration?: number, // For previews
            fade?: boolean,    // Enable fading
            normalize?: boolean // Audio normalization
        }],
        storage: {
            bucket: string,    // DO Spaces bucket
            path: string      // Base storage path
        },
        waveform?: {
            points: number    // 100-10000
        }
    },

    // Optional
    internal_id?: string,     // Your reference ID
    webhook_url?: string,     // Notification URL
    metadata?: object        // Custom metadata
}
```

#### Response
```json
{
    "job_id": "123",
    "status": "queued",
    "message": "Processing started"
}
```

### Check Job Status

```bash
GET /jobs/:jobId
```

#### Response
```json
{
    "job_id": "123",
    "internal_id": "model_123",
    "status": "completed",
    "progress": 100,
    "outputs": [
        {
            "url": "https://bucket.endpoint.com/path/full.mp3",
            "key": "path/full.mp3",
            "filename": "full.mp3",
            "format": "mp3",
            "quality": "high",
            "type": "full"
        }
    ],
    "waveform": {
        "points": 1000,
        "data": [/* normalized values */]
    },
    "metadata": {
        "custom": "data"
    }
}
```

### Get Processing Stats

```bash
GET /stats
```

#### Response
```json
{
    "current": {
        "waiting": 0,
        "active": 1,
        "delayed": 0
    },
    "total": {
        "completed": 100,
        "failed": 2
    },
    "last24Hours": 25,
    "uptime": 86400,
    "timestamp": "2024-11-26T18:25:43.511Z"
}
```

### Health Check

```bash
GET /health
```

#### Response
```json
{
    "status": "healthy",
    "timestamp": "2024-11-26T18:25:43.511Z",
    "details": {
        "redis": "connected",
        "worker": "running",
        "queue": {
            "name": "audio-processing",
            "active": 1,
            "waiting": 0
        }
    }
}
```

## Environment Configuration

```env
# Required Variables
API_KEYS=comma,separated,keys                    # API authentication keys
REDIS_URL=rediss://default:pass@host:port       # Redis connection URL
STORAGE_ENDPOINT=nyc3.digitaloceanspaces.com    # DO Spaces endpoint
STORAGE_REGION=nyc3                             # DO Spaces region
STORAGE_ACCESS_KEY=your-access-key              # DO Spaces access key
STORAGE_SECRET_KEY=your-secret-key              # DO Spaces secret key
STORAGE_BUCKET=your-bucket                      # Default bucket

# Optional Variables with defaults
PORT=3000                                       # Server port
NODE_ENV=production                             # Environment
MAX_FILE_SIZE=300000000                        # 300MB max file size
MAX_DURATION=3600                              # 1 hour max duration
CONCURRENT_JOBS=2                              # Parallel jobs
TEMP_DIR=/tmp/soundwave                        # Temporary storage
```

## Deployment

### Prerequisites
- Node.js 18+
- Redis (managed service recommended)
- FFmpeg
- DO Spaces bucket with proper CORS
- At least 10GB storage for temp files

### Digital Ocean App Platform

1. Fork/clone repository
2. Create new App Platform app
3. Configure environment variables
4. Add managed Redis database
5. Enable trusted sources
6. Deploy application

Required App Spec:
```yaml
services:
- name: web
  instance_size: basic-s
  instance_count: 1
  run_command: npm start
  envs:
    - key: all_env_vars
      value: as_listed_above
  cors:
    allow_origins:
      - "https://*.your-domain.com"
```

### Docker Deployment

1. Build image:
```bash
docker build -t soundwave .
```

2. Run container:
```bash
docker run -p 3000:3000 \
  --env-file .env \
  -v /tmp/soundwave:/tmp/soundwave \
  soundwave
```

## Webhook Notifications

Soundwave sends detailed webhooks throughout processing:

### Processing Started
```json
{
    "job_id": "123",
    "internal_id": "model_123",
    "status": "processing",
    "progress": 10,
    "message": "Download complete"
}
```

### Processing Update
```json
{
    "job_id": "123",
    "internal_id": "model_123",
    "status": "processing",
    "progress": 50,
    "message": "Processed full.mp3",
    "current_output": {
        "filename": "full.mp3",
        "format": "mp3",
        "type": "full"
    }
}
```

### Processing Complete
```json
{
    "job_id": "123",
    "internal_id": "model_123",
    "status": "completed",
    "outputs": [
        {
            "url": "https://bucket.endpoint.com/path/full.mp3",
            "format": "mp3",
            "quality": "high",
            "type": "full"
        }
    ],
    "waveform": {
        "points": 1000,
        "data": [/* waveform data */]
    },
    "metadata": {/* original metadata */}
}
```

### Processing Failed
```json
{
    "job_id": "123",
    "internal_id": "model_123",
    "status": "failed",
    "error": "Detailed error message",
    "metadata": {/* original metadata */}
}
```

## Best Practices

### File Organization
- Use internal_id in paths
- Separate previews and full versions
- Use consistent naming schemes
- Group related files in folders

### Processing
- Use appropriate quality for use case
- Enable normalization for consistent volume
- Generate previews for large files
- Keep waveform resolution reasonable

### Error Handling
- Always provide webhook_url
- Store job_id for status checks
- Use internal_id for tracking
- Check file size before upload

### Performance
- Limit concurrent jobs based on CPU
- Clean up temp files
- Use appropriate instance sizes
- Monitor queue length

## Troubleshooting

### Common Issues

1. **Job Failed - Download Error**
   - Check file URL accessibility
   - Verify file size within limits
   - Ensure valid audio format

2. **Job Failed - Processing Error**
   - Check FFmpeg logs
   - Verify audio file not corrupted
   - Check temp directory permissions

3. **Upload Failed**
   - Verify storage credentials
   - Check bucket permissions
   - Ensure sufficient space

4. **Webhook Failed**
   - Check webhook URL accessibility
   - Verify correct URL format
   - Check for timeouts

### Debug Endpoints

```bash
# Check queue status
GET /debug/queues

# Check specific job
GET /debug/jobs/:id

# Service health
GET /health
```

## License

MIT

## Support

For issues and feature requests, please open an issue on GitHub.
