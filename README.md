# 🎵 Soundwave

A dedicated audio processing microservice that turns raw audio into streaming-ready formats. Like Coconut.co, but for audio (and eventually video).

## What is this?

Soundwave is a Node.js-based microservice that handles audio processing tasks:

- Transforms audio files into web-optimized formats (MP3, AAC, Opus)
- Generates audio waveform data for visualizations
- Creates short audio previews with fancy fade effects
- Handles files up to 1 hour in length
- Stores processed files in cloud storage (DO Spaces, S3)
- Provides webhook notifications for processing status
- Supports flexible output configurations

## Why?

Because audio processing is CPU-intensive and best handled outside your main application. Soundwave lets you offload these tasks to a dedicated service that:

- Scales independently
- Processes files asynchronously
- Handles the complexity of FFmpeg
- Manages temporary file storage
- Provides a simple REST API

## Quick Start

### Prerequisites

- Node.js 18+
- Redis
- FFmpeg
- Digital Ocean Spaces (or S3) account
- Docker (optional)

### Local Development

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Start Redis (if not using Docker)
redis-server

# Start development server
npm run dev
```

### Docker

```bash
# Build image
docker build -t soundwave .

# Run container
docker compose up
```

### Configuration

Required environment variables:

```env
# API Authentication
API_KEYS=your-secret-key-1,your-secret-key-2

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional

# Storage (DO Spaces or S3)
STORAGE_ENDPOINT=nyc3.digitaloceanspaces.com
STORAGE_REGION=nyc3
STORAGE_ACCESS_KEY=your-access-key
STORAGE_SECRET_KEY=your-secret-key

# Processing
MAX_FILE_SIZE=300MB
MAX_DURATION=3600
CONCURRENT_JOBS=2
```

## API Usage

### Submit Audio for Processing

```bash
curl -X POST https://your-soundwave-instance/process \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "file_url": "https://example.com/audio.mp3",
    "config": {
      "outputs": [
        {
          "format": "mp3",
          "quality": "high",
          "sample_rate": 44100,
          "channels": 2
        }
      ],
      "storage": {
        "provider": "do_spaces",
        "bucket": "your-bucket",
        "path": "processed/audio"
      },
      "waveform": {
        "points": 1000
      },
      "preview": {
        "duration": 30,
        "fade": true
      }
    },
    "webhook_url": "https://your-app.com/webhooks/audio",
    "metadata": {
      "user_id": 123,
      "post_id": 456
    }
  }'
```

### Check Job Status

```bash
curl https://your-soundwave-instance/jobs/job-id-here \
  -H "X-API-Key: your-api-key"
```

## Webhook Format

Your webhook URL will receive POST requests with processing updates:

```json
{
  "job_id": "job-123",
  "status": "completed",
  "outputs": [
    {
      "url": "https://spaces.example.com/processed/audio-123.mp3",
      "format": "mp3",
      "duration": 180.5,
      "size": 5242880
    }
  ],
  "waveform": {
    "data": [0.1, 0.3, 0.7, ...],
    "points": 1000
  },
  "preview": {
    "url": "https://spaces.example.com/processed/preview-123.mp3",
    "duration": 30
  },
  "metadata": {
    "user_id": 123,
    "post_id": 456
  }
}
```

## Development

We use Prettier for code formatting and ESLint for linting:

```bash
# Format code
npm run format

# Lint code
npm run lint
```

## License

MIT

## Contributing

Contributions welcome! Please read the [contributing guidelines](CONTRIBUTING.md) first.

## Credits

Built with ❤️ using:
- [Node.js](https://nodejs.org/)
- [FFmpeg](https://ffmpeg.org/)
- [BullMQ](https://docs.bullmq.io/)
- [Express](https://expressjs.com/)

## Support

- 📝 [Documentation](docs/README.md)
- 🐛 [Issue Tracker](https://github.com/yourusername/soundwave/issues)
- 💬 [Discussions](https://github.com/yourusername/soundwave/discussions)
