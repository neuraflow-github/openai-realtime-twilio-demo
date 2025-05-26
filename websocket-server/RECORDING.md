# Server-Side Call Recording

This server now includes built-in call recording capabilities that capture both sides of the conversation.

## Features

- **Automatic Recording**: All calls are recorded by default
- **Dual Stream Capture**: Records both inbound (user) and outbound (AI) audio
- **Audio Processing**: Automatically merges and converts recordings to MP3/WAV (requires ffmpeg)
- **Organized Storage**: Recordings are stored in timestamped directories
- **Configurable**: Control recording behavior via environment variables

## How It Works

1. **During Call**: Audio streams are captured in real-time
   - Inbound audio from Twilio (user's voice) → `inbound.raw`
   - Outbound audio from OpenAI (AI's voice) → `outbound.raw`

2. **After Call**: If ffmpeg is installed:
   - Merges both streams into a single stereo file
   - Converts from μ-law to MP3/WAV format
   - Left channel = User, Right channel = AI

## Configuration

Set these environment variables in your `.env` file:

```bash
# Enable/disable recording (default: true)
ENABLE_RECORDING=true

# Output format: mp3 or wav (default: mp3)
RECORDING_FORMAT=mp3

# Enable audio processing/merging (default: true)
RECORDING_PROCESS=true
```

## Recording Storage

Recordings are saved in the `recordings/` directory:

```
recordings/
├── SM123abc_2024-01-20T10-30-45-000Z/
│   ├── inbound.raw          # User's audio (μ-law)
│   ├── outbound.raw         # AI's audio (μ-law)
│   └── call_SM123abc_45s.mp3  # Merged & converted (if ffmpeg available)
```

## Requirements

- **Basic Recording**: No additional requirements
- **Audio Processing**: Install ffmpeg for merging and format conversion
  ```bash
  # macOS
  brew install ffmpeg
  
  # Ubuntu/Debian
  sudo apt-get install ffmpeg
  
  # Windows
  # Download from https://ffmpeg.org/download.html
  ```

## API Endpoints

### List Recordings
```bash
GET /recordings
```

Returns:
```json
{
  "recordings": [
    {
      "sessionId": "SM123abc",
      "timestamp": "2024-01-20T10-30-45-000Z",
      "directory": "SM123abc_2024-01-20T10-30-45-000Z",
      "files": ["inbound.raw", "outbound.raw", "call_SM123abc_45s.mp3"],
      "path": "/path/to/recordings/SM123abc_2024-01-20T10-30-45-000Z"
    }
  ],
  "recordingsDir": "/path/to/recordings",
  "activeRecordings": ["SM456def"]
}
```

## Playback Tips

### Raw Files (μ-law)
If ffmpeg is not available, you can still play the raw files:

```bash
# Using ffplay (comes with ffmpeg)
ffplay -f mulaw -ar 8000 -ac 1 recordings/*/inbound.raw

# Convert manually with ffmpeg
ffmpeg -f mulaw -ar 8000 -ac 1 -i inbound.raw -i outbound.raw \
  -filter_complex "[0:a][1:a]amerge=inputs=2[a]" -map "[a]" \
  -ac 2 -codec:a libmp3lame -b:a 128k output.mp3
```

### Processed Files
The MP3/WAV files can be played with any audio player. They're stereo files with:
- Left channel: User's voice
- Right channel: AI's voice

## Privacy & Security

⚠️ **Important**: Recordings may contain sensitive information. Ensure you:
- Have proper consent from all parties
- Comply with local recording laws
- Secure the recordings directory
- Implement retention policies
- Consider encryption for stored files

## Troubleshooting

1. **No merged files created**: Install ffmpeg
2. **Recordings directory not created**: Check write permissions
3. **Missing audio**: Verify ENABLE_RECORDING is not set to false
4. **Storage concerns**: Raw files are ~64KB/minute per channel