import { Mp3Encoder } from '@breezystack/lamejs';

export const SAMPLE_RATE = 24000;

export function assembleAudio(segments, pauseSeconds = .22) {
  if (!segments.length || segments.some(samples => !(samples instanceof Float32Array) || !samples.length || samples.some(value => !Number.isFinite(value)))) throw Error('Ungültige Audiodaten.');
  const pause = Math.round(SAMPLE_RATE * pauseSeconds);
  const length = segments.reduce((sum, samples) => sum + samples.length, 0) + pause * (segments.length - 1);
  const result = new Float32Array(length);
  let offset = 0;
  for (const samples of segments) { result.set(samples, offset); offset += samples.length + pause; }
  return result;
}

export function encodeMp3(samples) {
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, 128);
  const parts = [];
  for (let offset = 0; offset < samples.length; offset += 1152) {
    const slice = samples.subarray(offset, offset + 1152);
    const pcm = Int16Array.from(slice, value => Math.round(Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767)));
    const data = encoder.encodeBuffer(pcm);
    if (data.length) parts.push(new Uint8Array(data));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: 'audio/mpeg' });
}

export async function loadClip(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error('Die vorbereitete Ausrede konnte nicht geladen werden.');
  const bytes = await response.arrayBuffer();
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(bytes);
    if (buffer.sampleRate !== SAMPLE_RATE) throw Error('Unpassende Audio-Abtastrate.');
    const samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const values = buffer.getChannelData(channel);
      for (let i = 0; i < values.length; i++) samples[i] += values[i] / buffer.numberOfChannels;
    }
    return samples;
  } finally { await context.close(); }
}
