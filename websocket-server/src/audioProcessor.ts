import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const unlink = promisify(fs.unlink);
const exists = promisify(fs.exists);

export interface AudioProcessingOptions {
  inboundPath: string;
  outboundPath: string;
  outputPath: string;
  format?: 'mp3' | 'wav';
  deleteOriginals?: boolean;
}

export class AudioProcessor {
  /**
   * Merge two μ-law audio streams and convert to MP3/WAV
   * Uses ffmpeg to handle the conversion and merging
   */
  async mergeAndConvert(options: AudioProcessingOptions): Promise<void> {
    const {
      inboundPath,
      outboundPath,
      outputPath,
      format = 'mp3',
      deleteOriginals = false
    } = options;

    try {
      // Check if input files exist
      const [inboundExists, outboundExists] = await Promise.all([
        exists(inboundPath),
        exists(outboundPath)
      ]);

      if (!inboundExists || !outboundExists) {
        throw new Error('One or both audio files do not exist');
      }

      // Create output directory if it doesn't exist
      const outputDir = path.dirname(outputPath);
      await fs.promises.mkdir(outputDir, { recursive: true });

      // Build ffmpeg command
      // -f mulaw: input format is μ-law
      // -ar 8000: sample rate is 8kHz (Twilio standard)
      // -ac 1: mono audio
      // -i: input file
      // -filter_complex amerge: merge two audio streams
      // -ac 2: output as stereo (left=inbound, right=outbound)
      const ffmpegArgs = [
        '-f', 'mulaw',
        '-ar', '8000',
        '-ac', '1',
        '-i', inboundPath,
        '-f', 'mulaw',
        '-ar', '8000',
        '-ac', '1',
        '-i', outboundPath,
        '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]',
        '-map', '[a]',
        '-ac', '2'
      ];

      // Add format-specific options
      if (format === 'mp3') {
        ffmpegArgs.push('-codec:a', 'libmp3lame', '-b:a', '128k');
      } else if (format === 'wav') {
        ffmpegArgs.push('-codec:a', 'pcm_s16le');
      }

      ffmpegArgs.push(outputPath);

      console.log(`🎵 Merging audio files to ${format.toUpperCase()}...`);
      
      await this.runFFmpeg(ffmpegArgs);

      console.log(`✅ Audio merged successfully: ${outputPath}`);

      // Delete original files if requested
      if (deleteOriginals) {
        await Promise.all([
          unlink(inboundPath),
          unlink(outboundPath)
        ]);
        console.log('🗑️  Original files deleted');
      }
    } catch (error) {
      console.error('❌ Audio processing failed:', error);
      throw error;
    }
  }

  /**
   * Convert a single μ-law audio file to MP3/WAV
   */
  async convertSingle(
    inputPath: string,
    outputPath: string,
    format: 'mp3' | 'wav' = 'mp3'
  ): Promise<void> {
    try {
      const inputExists = await exists(inputPath);
      if (!inputExists) {
        throw new Error(`Input file does not exist: ${inputPath}`);
      }

      const ffmpegArgs = [
        '-f', 'mulaw',
        '-ar', '8000',
        '-ac', '1',
        '-i', inputPath
      ];

      if (format === 'mp3') {
        ffmpegArgs.push('-codec:a', 'libmp3lame', '-b:a', '128k');
      } else if (format === 'wav') {
        ffmpegArgs.push('-codec:a', 'pcm_s16le');
      }

      ffmpegArgs.push(outputPath);

      console.log(`🎵 Converting audio to ${format.toUpperCase()}...`);
      await this.runFFmpeg(ffmpegArgs);
      console.log(`✅ Audio converted successfully: ${outputPath}`);
    } catch (error) {
      console.error('❌ Audio conversion failed:', error);
      throw error;
    }
  }

  /**
   * Run ffmpeg command
   */
  private runFFmpeg(args: string[]): Promise<void> {
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
   * Check if ffmpeg is installed
   */
  async checkFFmpegInstalled(): Promise<boolean> {
    try {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      return new Promise((resolve) => {
        ffmpeg.on('error', () => resolve(false));
        ffmpeg.on('close', (code) => resolve(code === 0));
      });
    } catch {
      return false;
    }
  }
}

export const audioProcessor = new AudioProcessor();