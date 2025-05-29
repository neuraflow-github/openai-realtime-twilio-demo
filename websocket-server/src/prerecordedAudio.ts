import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { promisify } from 'util';

const exists = promisify(fs.exists);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

// Path to the pre-recorded consent denial message
const CONSENT_DENIAL_AUDIO_PATH = path.join(__dirname, '..', 'assets', 'short.wav');

// Cache for the converted audio chunks
let consentDenialAudioChunks: string[] | null = null;

/**
 * Convert WAV file to G.711 µ-law format and return as base64 chunks
 * The audio needs to be in 8kHz, mono, µ-law format for Twilio
 */
async function convertWavToUlawChunks(inputPath: string): Promise<string[]> {
  const tempDir = '/tmp/neurabot-audio';
  const tempPath = path.join(tempDir, `consent_denial_${Date.now()}.ulaw`);

  try {
    // Ensure temp directory exists
    await mkdir(tempDir, { recursive: true });

    // Check if input file exists
    const inputExists = await exists(inputPath);
    if (!inputExists) {
      throw new Error(`Input audio file not found: ${inputPath}`);
    }

    // Use ffmpeg to convert to 8kHz mono µ-law
    await runFFmpeg([
      '-i', inputPath,
      '-ar', '8000',
      '-ac', '1',
      '-acodec', 'pcm_mulaw',
      '-f', 'mulaw',
      tempPath
    ]);

    // Read the converted file
    const audioBuffer = await readFile(tempPath);

    // Split into 20ms chunks (160 bytes per chunk at 8kHz)
    const chunks: string[] = [];
    const chunkSize = 160; // 20ms of audio at 8kHz

    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.subarray(i, Math.min(i + chunkSize, audioBuffer.length));
      chunks.push(chunk.toString('base64'));
    }

    // Clean up temp file
    await unlink(tempPath);

    console.log(`✅ Converted audio to ${chunks.length} chunks (${Math.round(audioBuffer.length / 8000 * 1000)}ms total)`);

    return chunks;
  } catch (error) {
    console.error('Error converting audio:', error);
    throw error;
  }
}

/**
 * Run ffmpeg command
 */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);

    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('error', (error) => {
      if (error.message.includes('ENOENT')) {
        reject(new Error('ffmpeg not found. Please install ffmpeg to use audio processing features.'));
      } else {
        reject(error);
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Get the consent denial audio chunks
 * This function caches the result to avoid repeated conversions
 */
export async function getConsentDenialAudioChunks(): Promise<string[]> {
  if (consentDenialAudioChunks) {
    return consentDenialAudioChunks;
  }

  try {
    console.log('🎵 Converting consent denial audio to µ-law format...');
    consentDenialAudioChunks = await convertWavToUlawChunks(CONSENT_DENIAL_AUDIO_PATH);
    console.log('✅ Audio conversion completed successfully');
    return consentDenialAudioChunks;
  } catch (error) {
    console.error('❌ Failed to load consent denial audio:', error);
    throw error;
  }
}

/**
 * Preload the audio on startup
 */
export async function preloadAudio() {
  try {
    await getConsentDenialAudioChunks();
    console.log('✅ Pre-recorded audio loaded successfully');
  } catch (error) {
    console.error('❌ Failed to preload audio:', error);
  }
}