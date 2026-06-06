/*
 * One-shot release: bump the version, then produce BOTH artifacts —
 *   • dist-artifacts/logarium-<version>-chrome.zip   (web-ext build)
 *   • dist-artifacts/<addon-id>-<version>.xpi         (web-ext sign, AMO)
 *
 * Usage (run via `npm run release`, which loads .env for the AMO credentials):
 *   npm run release            # bump patch (the smallest part) — default
 *   npm run release -- minor   # bump minor
 *   npm run release -- major   # bump major
 *
 * public/manifest.json is the version source of truth (web-ext reads it for the
 * {version} filename placeholder). package.json is kept in sync for tidiness.
 * Bumping happens BEFORE the build so the new version is what gets packaged —
 * which also sidesteps AMO's "version already exists" rejection.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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

// Run a local CLI (node_modules/.bin/<bin>) and abort the release if it fails.
function run(bin, args) {
  const res = spawnSync(process.execPath, [join(root, 'node_modules', '.bin', bin), ...args], {
    stdio: 'inherit',
    cwd: root,
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

run('vite', ['build']);
run('web-ext', [
  'build', '--source-dir', 'dist', '--artifacts-dir', 'dist-artifacts',
  '--overwrite-dest', '--filename', 'logarium-{version}-chrome.zip',
]);
run('web-ext', [
  'sign', '--source-dir', 'dist', '--artifacts-dir', 'dist-artifacts', '--channel', 'unlisted',
]);

console.log(`\n✓ Released v${next}. Artifacts in extension/dist-artifacts/:`);
console.log(`    logarium-${next}-chrome.zip   (Chrome/zip)`);
console.log(`    <addon-id>-${next}.xpi         (Firefox/signed)`);
