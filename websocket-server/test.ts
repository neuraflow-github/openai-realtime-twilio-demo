// record-audio.js - Connect to WebSocket and save audio output
const WebSocket = require('ws');
const fs = require('fs');
const { spawn } = require('child_process');

class WebSocketAudioRecorder {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.audioChunks = [];
        this.streamSid = 'SM' + Math.random().toString(36).substr(2, 32);
        this.outputFilename = `recording_${Date.now()}`;
        this.isRecording = false;
    }

    connect() {
        console.log('🔌 Connecting to WebSocket...');
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
            console.log('✅ Connected! Starting session...');
            this.sendStartEvent();
            this.isRecording = true;
        });

        this.ws.on('message', (data) => {
            this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
        });

        this.ws.on('close', () => {
            console.log('🔌 Disconnected');
            if (this.isRecording) {
                this.saveAudio();
            }
        });
    }

    sendStartEvent() {
        const startEvent = {
            event: "start",
            start: {
                streamSid: this.streamSid,
                accountSid: "ACtest1234567890",
                callSid: "CAtest1234567890"
            }
        };

        console.log('📤 Sending start event');
        this.ws.send(JSON.stringify(startEvent));

        // Send some test audio after 1 second
        setTimeout(() => this.sendTestAudio(), 1000);
    }

    sendTestAudio() {
        console.log('🎤 Sending test audio (silence)...');

        // Send 5 seconds of μ-law silence
        const silenceInterval = setInterval(() => {
            if (this.ws.readyState === WebSocket.OPEN) {
                // μ-law silence is 0xFF (255)
                const silenceBuffer = Buffer.alloc(160, 0xFF); // 20ms of silence at 8kHz
                const mediaEvent = {
                    event: "media",
                    media: {
                        timestamp: Date.now(),
                        payload: silenceBuffer.toString('base64')
                    }
                };
                this.ws.send(JSON.stringify(mediaEvent));
            }
        }, 20); // Send every 20ms

        // Stop after 5 seconds and close
        setTimeout(() => {
            clearInterval(silenceInterval);
            console.log('🛑 Stopping recording...');
            this.ws.close();
        }, 5000);
    }

    handleMessage(data) {
        try {
            const message = JSON.parse(data);

            if (message.event === 'media' && message.media && message.media.payload) {
                // Decode the base64 audio data
                const audioBuffer = Buffer.from(message.media.payload, 'base64');
                this.audioChunks.push(audioBuffer);

                // Show progress
                const duration = (this.audioChunks.length * 20) / 1000; // Each chunk is ~20ms
                process.stdout.write(`\r🎵 Recording... ${duration.toFixed(1)}s`);
            } else if (message.event === 'mark') {
                // Mark events are for synchronization
            } else {
                console.log(`\n📨 Received: ${message.event}`);
            }
        } catch (e) {
            console.error('Failed to parse message:', e);
        }
    }

    saveAudio() {
        console.log('\n💾 Saving audio...');

        if (this.audioChunks.length === 0) {
            console.log('❌ No audio data received');
            return;
        }

        // Combine all audio chunks
        const combinedBuffer = Buffer.concat(this.audioChunks);
        const rawFilename = `${this.outputFilename}.ulaw`;

        // Save raw μ-law data
        fs.writeFileSync(rawFilename, combinedBuffer);
        console.log(`✅ Saved raw μ-law audio: ${rawFilename} (${combinedBuffer.length} bytes)`);

        // Try to convert to WAV using ffmpeg
        this.convertToWav(rawFilename);
    }

    convertToWav(rawFilename) {
        const wavFilename = `${this.outputFilename}.wav`;

        console.log('🔄 Converting to WAV...');

        const ffmpeg = spawn('ffmpeg', [
            '-f', 'mulaw',      // Input format
            '-ar', '8000',      // Sample rate 8kHz
            '-ac', '1',         // Mono
            '-i', rawFilename,  // Input file
            '-y',               // Overwrite output
            wavFilename         // Output file
        ]);

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ Converted to WAV: ${wavFilename}`);
                console.log(`🎧 You can play it with: play ${wavFilename}`);
            } else {
                console.log('❌ ffmpeg conversion failed');
                console.log('💡 To convert manually, use:');
                console.log(`   ffmpeg -f mulaw -ar 8000 -ac 1 -i ${rawFilename} ${wavFilename}`);
            }
        });

        ffmpeg.on('error', (err) => {
            if (err.code === 'ENOENT') {
                console.log('⚠️  ffmpeg not found. Install it to convert audio:');
                console.log('   macOS: brew install ffmpeg');
                console.log('   Ubuntu: sudo apt-get install ffmpeg');
                console.log(`\n📁 Raw μ-law file saved: ${rawFilename}`);
            }
        });
    }
}

// Run the recorder
if (require.main === module) {
    const wsUrl = process.argv[2] || 'wss://piglet-flying-abnormally.ngrok-free.app/call';

    console.log('🎙️  WebSocket Audio Recorder');
    console.log('============================');
    console.log(`URL: ${wsUrl}`);
    console.log('');


    const recorder = new WebSocketAudioRecorder(wsUrl);
    recorder.connect();

    // Handle Ctrl+C
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down...');
        if (recorder.ws) {
            recorder.ws.close();
        }
        process.exit(0);
    });
}

module.exports = WebSocketAudioRecorder;