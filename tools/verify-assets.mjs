import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';

const root = resolve('public/models');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
let total = 0;
for (const [role, asset] of Object.entries(manifest.assets)) {
  const whole = createHash('sha256');
  let bytes = 0;
  for (const shard of asset.shards) {
    const path = resolve(root, shard.url);
    if (!path.startsWith(root + sep)) throw Error(`Unsafe model path: ${role}`);
    const size = (await stat(path)).size;
    if (size !== shard.bytes || size >= 100 * 1024 * 1024) throw Error(`Invalid model file size: ${role}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) { hash.update(chunk); whole.update(chunk); }
    if (hash.digest('hex') !== shard.sha256) throw Error(`Model shard checksum failed: ${role}`);
    bytes += size;
  }
  if (bytes !== asset.bytes || whole.digest('hex') !== asset.sha256) throw Error(`Model checksum failed: ${role}`);
  total += bytes;
}
if (total !== manifest.modelBytes || total >= 1_000_000_000) throw Error('Invalid complete model size.');
console.log(`Verified every model shard and reconstructed asset: ${total} bytes`);

const publicRoot = resolve('public');
const profile = 'c90953352421463ebc9da45d8a916c47';
const reference = '7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c';
const conditioningHashes = new Map();
for (const [suffix, frames] of [['', 957], ['-4s', 100], ['-9s', 225]]) {
  const bytes = await readFile(resolve(publicRoot, `voice/gs-deutsche-bahn-durchsage${suffix}.json`));
  const voice = JSON.parse(bytes.toString('utf8'));
  if (voice.profileId !== profile || voice.referenceSha256 !== reference || voice.sampleRate !== 24000 || voice.refAudioTokens.length !== 8 || voice.refAudioTokens.some(row => row.length !== frames || row.some(id => !Number.isInteger(id) || id < 0 || id > 1023))) throw Error(`Invalid fixed conditioning: ${suffix || 'full'}`);
  conditioningHashes.set(frames, createHash('sha256').update(bytes).digest('hex'));
}
const catalogue = JSON.parse(await readFile(resolve(publicRoot, 'audio/excuses.json'), 'utf8'));
const clips = [...catalogue.excuses, catalogue.closing];
if (catalogue.profileId !== profile || catalogue.referenceSha256 !== reference || catalogue.excuses.length !== 5 || new Set(clips.map(clip => clip.id)).size !== 6) throw Error('Invalid fixed audio catalogue.');
for (const clip of clips) {
  if (!/^(excuse-0[1-5]|closing)$/.test(clip.id) || clip.url !== `audio/${clip.id}.mp3` || !clip.text?.trim()) throw Error('Invalid text/audio mapping.');
  const bytes = await readFile(resolve(publicRoot, clip.url));
  if (bytes.length !== clip.bytes || createHash('sha256').update(bytes).digest('hex') !== clip.sha256 || conditioningHashes.get(clip.generation.referenceFrames) !== clip.generation.conditioningSha256) throw Error(`Fixed clip checksum/provenance failed: ${clip.id}`);
}
console.log('Verified fixed conditioning and all six text/audio mappings and MP3 checksums.');
