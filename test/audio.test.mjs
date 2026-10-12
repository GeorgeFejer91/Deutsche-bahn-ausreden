import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleAudio, encodeMp3, SAMPLE_RATE } from '../src/audio.js';

test('audio assembly preserves segment order and MP3 encoder emits real MPEG frames', async () => {
  const tone = Float32Array.from({ length: SAMPLE_RATE }, (_, i) => .15 * Math.sin(2 * Math.PI * 440 * i / SAMPLE_RATE));
  const joined = assembleAudio([tone, tone], .25);
  assert.equal(joined.length, SAMPLE_RATE * 2.25);
  assert.equal(joined[SAMPLE_RATE], 0);
  assert.equal(joined[SAMPLE_RATE * 1.25 + 100], tone[100]);
  assert.throws(() => assembleAudio([new Float32Array([NaN])]));
  const blob = encodeMp3(joined);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/mpeg');
  assert.ok(bytes.length > 1000);
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1] & 0xe0, 0xe0);
});
