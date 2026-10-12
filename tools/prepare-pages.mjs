import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (resolve('.') !== resolve(root)) throw Error('Run from the repository root.');
const git = (args, options = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', ...options });
if (git(['status', '--porcelain']).trim()) throw Error('Commit the intended source before preparing Pages.');
const sourceCommit = git(['rev-parse', 'HEAD']).trim();
const dist = resolve('dist');
if (!(await readFile(join(dist, 'index.html'), 'utf8')).includes('Unabhängige Parodie')) throw Error('Build the website first.');
await writeFile(join(dist, '.gitattributes'), '* -text\n');
await writeFile(join(dist, 'build-info.json'), JSON.stringify({ sourceCommit }, null, 2) + '\n');
let total = 0, count = 0;
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    const path = join(directory, name), info = await stat(path);
    if (info.isDirectory()) await inspect(path);
    else {
      if (!info.isFile() || info.size >= 100 * 1024 * 1024) throw Error(`Invalid static file: ${path}`);
      total += info.size; count++;
    }
  }
}
await inspect(dist);
if (total >= 1_000_000_000) throw Error('Pages package exceeds 1 GB.');
await mkdir('.for-ai-local', { recursive: true });
const options = { cwd: dist, env: { ...process.env, GIT_DIR: resolve('.git'), GIT_INDEX_FILE: resolve('.for-ai-local/pages-index'), GIT_WORK_TREE: dist } };
const stagedGit = args => git(args, options);
stagedGit(['read-tree', '--empty']);
stagedGit(['add', '--all', '--', '.']);
const entries = stagedGit(['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map(row => {
  const [info, path] = row.split('\t');
  return { path, hash: info.split(' ')[1] };
});
if (entries.length !== count) throw Error('Generated file count mismatch.');
const hashes = git(['hash-object', '--no-filters', ...entries.map(entry => join(dist, entry.path))]).trim().split('\n');
if (entries.some((entry, index) => entry.hash !== hashes[index].trim())) throw Error('Git altered a generated asset.');
const tree = stagedGit(['write-tree']).trim();
const ref = 'refs/heads/gh-pages';
let previous;
try { previous = git(['rev-parse', '--verify', ref], { stdio: ['pipe', 'pipe', 'ignore'] }).trim(); }
catch (error) { if (error.status !== 128) throw error; }
const commit = git(['commit-tree', tree, ...(previous ? ['-p', previous] : []), '-m', `Build static Pages package from ${sourceCommit}`]).trim();
git(['update-ref', ref, commit, previous || '0000000000000000000000000000000000000000']);
const receipt = { sourceCommit, pagesCommit: commit, files: count, bytes: total, binaryIntegrity: 'Every staged file equals its built bytes', publication: 'Local branch prepared; push and Pages deployment are separate actions' };
await writeFile('.for-ai-local/pages-prepared.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
