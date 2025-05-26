import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { audioProcessor } from './audioProcessor';

const mkdir = promisify(fs.mkdir);

export interface RecordingSession {
  sessionId: string;
  startTime: Date;
  inboundPath: string;
  outboundPath: string;
  sessionDir: string;
  inboundStream: fs.WriteStream | null;
  outboundStream: fs.WriteStream | null;
}

export class RecordingManager {
  private recordings: Map<string, RecordingSession> = new Map();
  private recordingsDir: string;
  private enableProcessing: boolean = true;
  private outputFormat: 'mp3' | 'wav' = 'mp3';

  constructor() {
    this.recordingsDir = path.join(process.cwd(), 'recordings');
    this.ensureRecordingsDirectory();
    this.checkFFmpegAvailability();
  }

  private async ensureRecordingsDirectory(): Promise<void> {
    try {
      await mkdir(this.recordingsDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create recordings directory:', error);
    }
  }

  private async checkFFmpegAvailability(): Promise<void> {
    const isInstalled = await audioProcessor.checkFFmpegInstalled();
    if (!isInstalled) {
      console.warn('⚠️  ffmpeg not found. Audio merging/conversion will be disabled.');
      console.warn('   Install ffmpeg to enable audio processing features.');
      this.enableProcessing = false;
    } else {
      console.log('✅ ffmpeg found. Audio processing enabled.');
    }
  }

  async startRecording(sessionId: string): Promise<void> {
    if (this.recordings.has(sessionId)) {
      console.warn(`Recording already exists for session ${sessionId}`);
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionDir = path.join(this.recordingsDir, `${sessionId}_${timestamp}`);
    
    try {
      await mkdir(sessionDir, { recursive: true });
      
      const inboundPath = path.join(sessionDir, 'inbound.raw');
      const outboundPath = path.join(sessionDir, 'outbound.raw');
      
      const session: RecordingSession = {
        sessionId,
        startTime: new Date(),
        inboundPath,
        outboundPath,
        sessionDir,
        inboundStream: fs.createWriteStream(inboundPath),
        outboundStream: fs.createWriteStream(outboundPath)
      };
      
      this.recordings.set(sessionId, session);
      console.log(`Started recording for session ${sessionId}`);
    } catch (error) {
      console.error(`Failed to start recording for session ${sessionId}:`, error);
    }
  }

  async writeInboundAudio(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.recordings.get(sessionId);
    if (!session || !session.inboundStream) {
      return;
    }

    try {
      session.inboundStream.write(audioData);
    } catch (error) {
      console.error(`Failed to write inbound audio for session ${sessionId}:`, error);
    }
  }

  async writeOutboundAudio(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.recordings.get(sessionId);
    if (!session || !session.outboundStream) {
      return;
    }

    try {
      session.outboundStream.write(audioData);
    } catch (error) {
      console.error(`Failed to write outbound audio for session ${sessionId}:`, error);
    }
  }

  async stopRecording(sessionId: string): Promise<void> {
    const session = this.recordings.get(sessionId);
    if (!session) {
      console.warn(`No recording found for session ${sessionId}`);
      return;
    }

    try {
      // Close streams
      if (session.inboundStream) {
        session.inboundStream.end();
      }
      if (session.outboundStream) {
        session.outboundStream.end();
      }

      // Remove from active recordings
      this.recordings.delete(sessionId);
      
      console.log(`Stopped recording for session ${sessionId}`);
      console.log(`Raw audio files saved at:`);
      console.log(`  Inbound: ${session.inboundPath}`);
      console.log(`  Outbound: ${session.outboundPath}`);
      
      // Process audio if ffmpeg is available
      if (this.enableProcessing) {
        // Small delay to ensure streams are fully closed
        setTimeout(async () => {
          try {
            const duration = Math.floor((Date.now() - session.startTime.getTime()) / 1000);
            const outputFileName = `call_${sessionId}_${duration}s.${this.outputFormat}`;
            const outputPath = path.join(session.sessionDir, outputFileName);
            
            await audioProcessor.mergeAndConvert({
              inboundPath: session.inboundPath,
              outboundPath: session.outboundPath,
              outputPath,
              format: this.outputFormat,
              deleteOriginals: false // Keep originals for now
            });
            
            console.log(`🎉 Processed recording saved: ${outputPath}`);
          } catch (error) {
            console.error('Failed to process audio:', error);
            console.log('Raw audio files are still available for manual processing.');
          }
        }, 500);
      }
    } catch (error) {
      console.error(`Failed to stop recording for session ${sessionId}:`, error);
    }
  }

  getActiveRecordings(): string[] {
    return Array.from(this.recordings.keys());
  }

  /**
   * Configure recording options
   */
  setOptions(options: {
    enableProcessing?: boolean;
    outputFormat?: 'mp3' | 'wav';
  }): void {
    if (options.enableProcessing !== undefined) {
      this.enableProcessing = options.enableProcessing;
    }
    if (options.outputFormat !== undefined) {
      this.outputFormat = options.outputFormat;
    }
  }

  /**
   * Get recordings directory path
   */
  getRecordingsDirectory(): string {
    return this.recordingsDir;
  }
}

// Singleton instance
export const recordingManager = new RecordingManager();