/*
 * One-shot release: bump the version, then produce BOTH artifacts —
 *   • dist-artifacts/logarium-<version>-chrome.zip   (web-ext build)
 *   • dist-artifacts/<addon-id>-<version>.xpi         (web-ext sign, AMO)
 *
 * Usage:
 *   npm run release            # bump patch (the smallest part) — default
 *   npm run release -- minor   # bump minor
 *   npm run release -- major   # bump major
 *
 * public/manifest.json is the version source of truth (web-ext reads it for the
 * {version} filename placeholder). package.json is kept in sync for tidiness.
 * Bumping happens BEFORE the build so the new version is what gets packaged —
 * which also sidesteps AMO's "version already exists" rejection.
 *
 * IMPORTANT: we must NOT run this under `node --env-file=.env`. That would put
 * VITE_API_BASE=localhost (from .env) into process.env, and Vite ranks real env
 * vars ABOVE .env.production — so the build would bake in the localhost backend
 * and ship a broken extension. Instead we read .env ourselves and pass ONLY the
 * AMO credentials to the `web-ext sign` step, and we strip VITE_API_BASE from
 * the build step's environment so it always resolves from .env.production.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PARTS = ['major', 'minor', 'patch'];

function bumpVersion(current, part) {
  const nums = current.split('.').map((n) => parseInt(n, 10));
  if (nums.length !== 3 || nums.some(Number.isNaN)) {
    throw new Error(`manifest version "${current}" is not x.y.z`);
  }
  const [maj, min, pat] = nums;
  if (part === 'major') return `${maj + 1}.0.0`;
  if (part === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`; // patch
}

// Rewrite a JSON file's "version" field, preserving 2-space indent + trailing NL.
function setVersion(file, version) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.version = version;
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

// Minimal KEY=VALUE parser for .env (we only need the AMO credentials).
function loadEnvFile(file) {
  const out = {};
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

// Run a local CLI (node_modules/.bin/<bin>) and abort the release if it fails.
// `extraEnv` is merged in; VITE_API_BASE is always stripped so the build can
// only ever read the backend URL from .env.production (never an ambient/.env
// localhost value that would ship a broken extension).
function run(bin, args, extraEnv) {
  const env = { ...process.env, ...(extraEnv || {}) };
  delete env.VITE_API_BASE;
  const res = spawnSync(process.execPath, [join(root, 'node_modules', '.bin', bin), ...args], {
    stdio: 'inherit',
    cwd: root,
    env,
  });
  if (res.status !== 0) {
    console.error(`\n✗ ${bin} ${args.join(' ')} failed (exit ${res.status}).`);
    process.exit(res.status ?? 1);
  }
}

const part = (process.argv[2] || 'patch').toLowerCase();
if (!PARTS.includes(part)) {
  console.error(`Unknown version part "${part}". Use one of: ${PARTS.join(', ')}.`);
  process.exit(1);
}

const manifestPath = join(root, 'public', 'manifest.json');
const pkgPath = join(root, 'package.json');
const current = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
const next = bumpVersion(current, part);

console.log(`▶ Releasing ${current} → ${next} (${part} bump)\n`);
setVersion(manifestPath, next);
setVersion(pkgPath, next);

// AMO credentials for `web-ext sign` — read from .env, passed only to that step.
const env = loadEnvFile(join(root, '.env'));
const amoCreds = {};
for (const key of ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET']) {
  if (env[key]) amoCreds[key] = env[key];
}
if (!amoCreds.WEB_EXT_API_KEY || !amoCreds.WEB_EXT_API_SECRET) {
  console.error('✗ Missing WEB_EXT_API_KEY / WEB_EXT_API_SECRET in extension/.env (needed to sign the .xpi).');
  process.exit(1);
}

run('vite', ['build']);
run('web-ext', [
  'build', '--source-dir', 'dist', '--artifacts-dir', 'dist-artifacts',
  '--overwrite-dest', '--filename', 'logarium-{version}-chrome.zip',
]);
run('web-ext', [
  'sign', '--source-dir', 'dist', '--artifacts-dir', 'dist-artifacts', '--channel', 'unlisted',
], amoCreds);

// Both new artifacts now exist — prune every older .zip/.xpi so the dir only
// ever holds the current version. Anything whose name doesn't contain the new
// version string is a previous release; keep the just-built files.
const artifactsDir = join(root, 'dist-artifacts');
let pruned = 0;
for (const file of readdirSync(artifactsDir)) {
  if (!/\.(zip|xpi)$/i.test(file)) continue;
  if (file.includes(next)) continue; // keep the just-built artifacts
  unlinkSync(join(artifactsDir, file));
  console.log(`  ✗ removed old artifact ${file}`);
  pruned += 1;
}
if (pruned) console.log(`  pruned ${pruned} previous artifact${pruned === 1 ? '' : 's'}.`);

console.log(`\n✓ Released v${next}. Artifacts in extension/dist-artifacts/:`);
console.log(`    logarium-${next}-chrome.zip   (Chrome/zip)`);
console.log(`    <addon-id>-${next}.xpi         (Firefox/signed)`);
