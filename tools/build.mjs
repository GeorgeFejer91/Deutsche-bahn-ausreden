import { build } from 'esbuild';
import { cp, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve('dist');
if (dist !== fileURLToPath(new URL('../dist', import.meta.url))) throw Error('Run the build from the repository root.');
await rm(dist, { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await mkdir('dist/runtime', { recursive: true });
await cp('node_modules/@breezystack/lamejs/dist/lamejs.js', 'dist/runtime/lamejs.js');
for (const name of await readdir('node_modules/onnxruntime-web/dist')) {
  if (/^ort-wasm-simd-threaded.*\.(mjs|wasm)$/.test(name)) await cp(join('node_modules/onnxruntime-web/dist', name), join('dist/runtime', name));
}
await build({ entryPoints: ['src/app.js', 'src/speech-worker.js'], outdir: 'dist', bundle: true, external: ['@breezystack/lamejs'], format: 'esm', target: 'es2022', minify: true, assetNames: 'fonts/[name]-[hash]', loader: { '.woff2': 'file', '.woff': 'file' }, metafile: true });
let total = 0;
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name), info = await stat(path);
    if (info.isDirectory()) await inspect(path);
    else {
      total += info.size;
      if (info.size >= 100 * 1024 * 1024) throw Error(`Static file exceeds ordinary Git limit: ${path}`);
    }
  }
}
await inspect(resolve('dist'));
if (total > 1_000_000_000) throw Error(`GitHub Pages package exceeds 1 GB: ${total}`);
console.log(`Built static site: ${total} bytes`);
