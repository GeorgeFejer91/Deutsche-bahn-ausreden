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
