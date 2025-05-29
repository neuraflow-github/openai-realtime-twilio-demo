import dotenv from 'dotenv';
dotenv.config();

interface TwilioRecordingOptions {
  callSid: string;
  recordingStatusCallback?: string;
  recordingStatusCallbackEvent?: string[];
  recordingChannels?: 'mono' | 'dual';
  trim?: 'trim-silence' | 'do-not-trim';
}

export async function startTwilioRecording(options: TwilioRecordingOptions): Promise<any> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured');
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${options.callSid}/Recordings.json`;
  
  const params = new URLSearchParams({
    RecordingChannels: options.recordingChannels || 'dual',
    Trim: options.trim || 'trim-silence'
  });

  if (options.recordingStatusCallback) {
    params.append('RecordingStatusCallback', options.recordingStatusCallback);
  }

  if (options.recordingStatusCallbackEvent) {
    params.append('RecordingStatusCallbackEvent', options.recordingStatusCallbackEvent.join(' '));
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    },
    body: params
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to start recording: ${error}`);
  }

  return response.json();
}

export async function stopTwilioRecording(callSid: string, recordingSid: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}/Recordings/${recordingSid}.json`;
  
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    },
    body: new URLSearchParams({ Status: 'stopped' })
  });
}