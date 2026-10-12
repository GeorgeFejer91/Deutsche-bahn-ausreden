// Build-time only. Production inference fetches strictly same-origin GitHub assets.
import { mkdir, stat, writeFile, rename, copyFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';

const community = { repository: 'onnx-community/OmniVoice-Onnx', revision: 'a7be7c65cc118137683f49eff0f80fdf9d5b5dbf' };
const backbone = { repository: 'PranavBoi/omnivoice-web', revision: '53e33f3b219c28604297635640631f9457bcce14' };
const files = [
  ['embeddings', community, 'int4/audio_embeddings_encoder.onnx', 2363, 'f21daf4ee076c841d210b8941063a057c6e36d2bc04f4405daefa15b82c05563'],
  ['embeddingsData', community, 'int4/audio_embeddings_encoder.onnx.data', 87160832, 'f6ed8d313fa5f6d2d33f3ad0af077dd1ba6d607f2a573cb389f28eec53f84393'],
  ['heads', community, 'int4/audio_heads_decoder.onnx', 4462676, '389f2133371f7f0bd678aba8cf1eac102ee4b227d3372f49bd181c591b890360'],
  ['backbone', backbone, 'llm_decoder_int4.onnx', 4022710, '9180a1e2b41b0433919f9d1775e97c18320033b3a6c865845eeceec168dd0863'],
  ['backboneData', backbone, 'llm_decoder_int4.onnx.data', 275484672, 'a7d26bc998f295e11fdfd670d95f6c9de872c88c0e717086c9a846185ad2d0e8'],
  ['decoder', community, 'audio_tokenizer/higgs_decoder.onnx', 86500102, 'b28b3317a6cbf0d0f4a71b476ecb5c767612a31702da6561154783c94b6fa806'],
  ['tokenizer', community, 'int4/tokenizer.json', 11423986, '408f669b7e2b045fdf54201d815bd364e6667dbd845115da81239c40bc6dcfd1'],
  ['tokenizerConfig', community, 'int4/tokenizer_config.json', 533, '49f78845596a82bf15c83673794bdf9f76f812b11f60ab6a2239d9be65b00676'],
];
const output = resolve('public/models');
const cache = resolve('.for-ai-local/split-model');
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
async function digest(path) {
  const hash = createHash('sha256');
  for await (const data of createReadStream(path)) hash.update(data);
  return hash.digest('hex');
}

const assets = {};
for (const [role, source, filename, bytes, sha256] of files) {
  const cached = resolve(cache, filename);
  await mkdir(dirname(cached), { recursive: true });
  let valid = false;
  try { valid = (await stat(cached)).size === bytes && await digest(cached) === sha256; } catch { /* No verified cache yet. */ }
  const partial = `${cached}.partial`;
  if (!valid) {
    try {
      if ((await stat(partial)).size === bytes && await digest(partial) === sha256) {
        await rename(partial, cached);
        valid = true;
      }
    } catch { /* Interrupted download is not a verified asset. */ }
  }
  if (!valid) {
    const url = `https://huggingface.co/${source.repository}/resolve/${source.revision}/${filename}`;
    const response = await fetch(url);
    if (!response.ok) throw Error(`${role}: HTTP ${response.status}`);
    console.log(`Downloading ${role}: ${bytes} bytes`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    if ((await stat(partial)).size !== bytes || await digest(partial) !== sha256) throw Error(`${role}: size/hash mismatch`);
    await rename(partial, cached);
  }
  const shards = [];
  const name = basename(filename);
  if (bytes > 48 * 1024 * 1024) {
    let index = 0;
    for await (const data of createReadStream(cached, { highWaterMark: 48 * 1024 * 1024 })) {
      const url = `${name}.part-${++index}.bin`;
      await writeFile(resolve(output, url), data);
      shards.push({ url, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
  } else {
    await copyFile(cached, resolve(output, name));
    shards.push({ url: name, bytes, sha256 });
  }
  assets[role] = { bytes, sha256, logicalName: name, shards, source: { ...source, filename } };
  console.log(`Verified and packaged ${role}: ${shards.length} file(s)`);
}
const modelBytes = files.reduce((sum, file) => sum + file[3], 0);
const manifest = { version: 1, precision: 'int4', language: 'de', sampleRate: 24000, frameRate: 25, codebooks: 8, maskId: 1024, modelBytes, assets };
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Verified fixed-voice inference package: ${modelBytes} bytes (no reference encoder/ASR)`);
