// Fixed conditioning only. No reference encoder, ASR, voice upload or server.
import * as ort from 'onnxruntime-web/webgpu';
import { Tokenizer } from '@huggingface/tokenizers';
import { iterativeUnmaskCfg } from './speech/algorithm.ts';

// Keep the real-browser baseline until the upstream 16-step setting is qualified.
const RATE = 24000, CODEBOOKS = 8, MASK = 1024, STEPS = 32;
const VOICE_ID = 'c90953352421463ebc9da45d8a916c47';
const REFERENCE_SHA = '7f42fc8c38fd7d1115f40f62b03c7b6897a44ed15bc661fa1e23ae5c5094001c';
const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
function sameOrigin(value) {
  const url = new URL(value, self.location.href);
  if (url.origin !== self.location.origin) throw Error('Die Stimme muss vollständig von dieser Website geladen werden.');
  return url;
}
async function json(url) {
  const response = await fetch(sameOrigin(url));
  if (!response.ok) throw Error(`Die Stimmdatei konnte nicht geladen werden (${response.status}).`);
  return response.json();
}
async function asset(asset, base, progress) {
  const output = new Uint8Array(asset.bytes);
  let offset = 0, cache;
  try { cache = await caches.open('bahn-voice-shards-v1'); } catch { /* Verified direct loading still works without storage. */ }
  for (const shard of asset.shards) {
    const url = sameOrigin(new URL(shard.url, base));
    let bytes;
    const cached = await cache?.match(url);
    if (cached) {
      const candidate = new Uint8Array(await cached.arrayBuffer());
      if (candidate.length === shard.bytes && await sha(candidate) === shard.sha256) bytes = candidate;
      else await cache.delete(url);
    }
    if (!bytes) {
      const response = await fetch(url);
      if (!response.ok) throw Error(`Eine Modelldatei fehlt (${response.status}).`);
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== shard.bytes || await sha(bytes) !== shard.sha256) throw Error('Eine Modelldatei ist unvollständig. Bitte erneut versuchen.');
      try { await cache?.put(url, new Response(bytes)); } catch { /* Cache quota is not required for generation. */ }
    }
    if (offset + bytes.length > output.length) throw Error('Ungültige Modellgröße.');
    output.set(bytes, offset); offset += bytes.length; progress(bytes.length);
  }
  if (offset !== asset.bytes || await sha(output) !== asset.sha256) throw Error('Die Modellprüfung ist fehlgeschlagen.');
  return output;
}
function validateVoice(voice) {
  const frames = voice.refAudioTokens?.[0]?.length;
  if (voice.name !== 'GS Deutsche Bahn Durchsage' || voice.profileId !== VOICE_ID || voice.referenceSha256 !== REFERENCE_SHA || voice.sampleRate !== RATE || !voice.refText?.trim() || !Number.isFinite(voice.refRms) || voice.refRms <= 0 || !frames || voice.refAudioTokens.length !== CODEBOOKS || voice.refAudioTokens.some(row => row.length !== frames || row.some(x => !Number.isInteger(x) || x < 0 || x >= MASK))) throw Error('Das feste Stimmprofil ist nicht gültig.');
  return frames;
}
const weight = text => Array.from(text).reduce((n, c) => n + (/\s/u.test(c) ? .3 : /[.,!?;:]/u.test(c) ? .5 : 1), 0);
export function speechChunks(text, maximum = 180) {
  const chunks = []; let current = '';
  for (const word of text.trim().split(/\s+/u)) {
    if (word.length > maximum) {
      if (current) { chunks.push(current); current = ''; }
      const chars = Array.from(word);
      while (chars.length) chunks.push(chars.splice(0, maximum).join(''));
    } else if (current && current.length + word.length + 1 > maximum) {
      chunks.push(current); current = word;
    } else current += `${current ? ' ' : ''}${word}`;
  }
  if (current) chunks.push(current);
  return chunks;
}
function prepared(tokenizer, text, voice, frames, refFrames) {
  const encode = value => tokenizer.encode(value, { add_special_tokens: false }).ids;
  const prefix = ['<|denoise|>', '<|lang_start|>', 'de', '<|lang_end|>', '<|instruct_start|>', 'None', '<|instruct_end|>', '<|text_start|>', `${voice.refText.trim()} ${text.trim()}`, '<|text_end|>'].flatMap(encode);
  const genStart = prefix.length + refFrames, condSeq = genStart + frames;
  const condIds = new Int32Array(CODEBOOKS * condSeq).fill(MASK);
  for (let cb = 0; cb < CODEBOOKS; cb++) {
    condIds.set(prefix, cb * condSeq);
    condIds.set(voice.refAudioTokens[cb], cb * condSeq + prefix.length);
  }
  const condMask = new Uint8Array(condSeq); condMask.fill(1, prefix.length);
  return { condIds, condMask, condSeq, genStart, uncondIds: new Int32Array(CODEBOOKS * frames).fill(MASK), uncondMask: new Uint8Array(frames).fill(1) };
}
const int64 = values => BigInt64Array.from(values, value => BigInt(value));
const dispose = object => Object.values(object ?? {}).forEach(tensor => tensor.dispose());

export class FixedVoiceEngine {
  sessions = {};
  async load(baseUrl, voiceUrl, progress) {
    const start = performance.now();
    if (!navigator.gpu) throw Error('Diese Stimme benötigt WebGPU. Bitte einen aktuellen Chrome- oder Edge-Browser mit Grafikbeschleunigung verwenden.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter || adapter.info?.isFallbackAdapter) throw Error('Für diese Stimme ist keine geeignete Grafikkarte verfügbar.');
    ort.env.webgpu.adapter = adapter;
    ort.env.wasm.numThreads = 1; // Pages does not provide cross-origin isolation headers.
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('./runtime/', self.location.href).href;
    ort.env.logLevel = 'warning';
    const base = sameOrigin(baseUrl), manifest = await json(new URL('manifest.json', base));
    if (manifest.version !== 1 || manifest.codebooks !== CODEBOOKS || manifest.sampleRate !== RATE || manifest.language !== 'de' || manifest.precision !== 'int4') throw Error('Unbekanntes Stimmformat.');
    this.voice = await json(voiceUrl); this.refFrames = validateVoice(this.voice);
    let loaded = 0;
    const read = role => asset(manifest.assets[role], base, count => {
      loaded += count;
      progress(`Die Stimme wird geladen: ${Math.round(loaded / 1e6)} von ${Math.round(manifest.modelBytes / 1e6)} MB.`, .8 * loaded / manifest.modelBytes);
    });
    const decoder = new TextDecoder();
    this.tokenizer = new Tokenizer(JSON.parse(decoder.decode(await read('tokenizer'))), JSON.parse(decoder.decode(await read('tokenizerConfig'))));
    for (const token of ['<|denoise|>', '<|lang_start|>', '<|lang_end|>', '<|instruct_start|>', '<|instruct_end|>', '<|text_start|>', '<|text_end|>']) {
      if (this.tokenizer.encode(token, { add_special_tokens: false }).ids.length !== 1) throw Error('Die Sprachtoken sind nicht kompatibel.');
    }
    for (const [role, externalRole] of [['embeddings', 'embeddingsData'], ['backbone', 'backboneData'], ['heads'], ['decoder']]) {
      const model = await read(role);
      const externalData = externalRole ? [{ path: manifest.assets[externalRole].logicalName, data: await read(externalRole) }] : undefined;
      progress('Die Stimme wird auf der Grafikkarte vorbereitet.', .8 + Object.keys(this.sessions).length * .05);
      this.sessions[role] = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all', externalData });
    }
    for (const [role, inputs, outputs] of [['embeddings', ['input_ids', 'audio_mask'], ['inputs_embeds']], ['backbone', ['inputs_embeds'], ['hidden_states']], ['heads', ['hidden_states'], ['logits']], ['decoder', ['codes'], ['waveform_24k']]]) {
      const session = this.sessions[role];
      if (session.inputNames.join() !== inputs.join() || session.outputNames.join() !== outputs.join()) throw Error(`Das ${role}-Modell ist nicht kompatibel.`);
    }
    this.device = { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, device: adapter.info?.device, description: adapter.info?.description };
    return { modelBytes: manifest.modelBytes, loadMilliseconds: performance.now() - start, device: this.device, browser: navigator.userAgent };
  }
  async step(inputIds, audioMask, seq, genStart, frames, timings) {
    let embeddings, hidden, logits;
    const ids = new ort.Tensor('int64', int64(inputIds), [1, CODEBOOKS, seq]);
    const mask = new ort.Tensor('bool', audioMask, [1, seq]);
    try {
      const started = performance.now();
      embeddings = await this.sessions.embeddings.run({ input_ids: ids, audio_mask: mask });
      const embedded = performance.now();
      hidden = await this.sessions.backbone.run({ inputs_embeds: embeddings.inputs_embeds });
      const inferred = performance.now();
      // Audio heads are position-wise. Only generated positions need logits.
      const target = new ort.Tensor('float32', hidden.hidden_states.data.slice(genStart * 1024, (genStart + frames) * 1024), [1, frames, 1024]);
      try { logits = await this.sessions.heads.run({ hidden_states: target }); }
      finally { target.dispose(); }
      const projected = performance.now();
      const result = new Float32Array(logits.logits.data);
      timings.push({ pass: genStart ? 'conditioned' : 'unconditioned', sequence: seq, embeddings: embedded - started, backbone: inferred - embedded, heads: projected - inferred, readback: performance.now() - projected });
      return result;
    } finally { ids.dispose(); mask.dispose(); dispose(embeddings); dispose(hidden); dispose(logits); }
  }
  async generate(text, progress) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000 || /<\|[^>]*\|>/u.test(text)) throw Error('Bitte einen gültigen Durchsagetext eingeben.');
    const started = performance.now(), chunks = speechChunks(text), samples = [], timings = [];
    for (let index = 0; index < chunks.length; index++) {
      const frames = Math.max(40, Math.round(weight(chunks[index]) / weight(this.voice.refText) * this.refFrames));
      if (frames > 600) throw Error('Dieser Textabschnitt ist für die Stimme zu lang.');
      const inputs = prepared(this.tokenizer, chunks[index], this.voice, frames, this.refFrames);
      const passes = [], unmaskStarted = performance.now();
      const codes = await iterativeUnmaskCfg(inputs, frames, STEPS, { guidanceScale: 2, tShift: .1, layerPenalty: 5, positionTemperature: 5, seed: 0 }, (...args) => this.step(...args, passes), step => progress(`Die Durchsage entsteht: Abschnitt ${index + 1} von ${chunks.length}, Schritt ${step} von ${STEPS}.`, (index + step / STEPS) / chunks.length));
      const unmaskMilliseconds = performance.now() - unmaskStarted;
      const tensor = new ort.Tensor('int64', int64(codes), [CODEBOOKS, 1, frames]); let decoded;
      try {
        const decodeStarted = performance.now();
        decoded = await this.sessions.decoder.run({ codes: tensor });
        const decodedAt = performance.now();
        const audio = new Float32Array(decoded.waveform_24k.data);
        if (!audio.length || audio.some(value => !Number.isFinite(value))) throw Error('Die Stimme hat ungültiges Audio erzeugt.');
        if (this.voice.refRms < .1) for (let i = 0; i < audio.length; i++) audio[i] *= this.voice.refRms / .1;
        samples.push(audio);
        timings.push({ frames, steps: STEPS, unmaskMilliseconds, samplingMilliseconds: unmaskMilliseconds - passes.reduce((sum, pass) => sum + pass.embeddings + pass.backbone + pass.heads + pass.readback, 0), decoderMilliseconds: decodedAt - decodeStarted, decoderReadbackMilliseconds: performance.now() - decodedAt, passes });
      } finally { tensor.dispose(); dispose(decoded); }
    }
    const pause = Math.round(.12 * RATE), length = samples.reduce((n, audio) => n + audio.length, 0) + (samples.length - 1) * pause;
    const output = new Float32Array(length); let offset = 0;
    for (const audio of samples) { output.set(audio, offset); offset += audio.length + pause; }
    return { samples: output, sampleRate: RATE, generationMilliseconds: performance.now() - started, steps: STEPS, timings, device: this.device };
  }
  async dispose() {
    for (const session of Object.values(this.sessions)) await session.release();
    this.sessions = {};
  }
}
