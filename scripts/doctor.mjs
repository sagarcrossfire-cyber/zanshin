#!/usr/bin/env node
// Release doctor (2.0, docs/REFERENCE.md §5 and §7). Checks that everything
// naming the version agrees and that no scratch files slipped into the repo,
// and prints the fix for each problem. Runs in CI after the build and locally
// before a release PR: `npm run doctor`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const problems = [];
const read = (path) => readFileSync(join(root, path), 'utf8');
const fail = (what, fix) => problems.push({ fix, what });

const version = JSON.parse(read('package.json')).version;

// 1. The app's own version constant.
const backup = read('src/services/backup.ts');
const appVersion = /export const APP_VERSION = '([^']+)'/.exec(backup)?.[1];
if (appVersion !== version) {
  fail(`APP_VERSION is ${appVersion ?? 'missing'} but package.json says ${version}`, `set APP_VERSION = '${version}' in src/services/backup.ts`);
}

// 2. README versions list and the release note.
if (!read('README.md').includes(`- ${version} — `)) {
  fail(`README.md has no "- ${version} — …" line in its versions list`, 'add a one-line entry under "## Versions"');
}
if (!existsSync(join(root, 'docs', `RELEASE_${version}.md`))) {
  fail(`docs/RELEASE_${version}.md is missing`, 'write the release note (what changed for Sagar, how it works, tests)');
}

// 3. The reference doc names the current version.
const reference = existsSync(join(root, 'docs/REFERENCE.md')) ? read('docs/REFERENCE.md') : '';
if (!reference.includes(`Current version: **${version}**`)) {
  fail(`docs/REFERENCE.md does not say "Current version: **${version}**"`, 'update the version line (and any section the release changed)');
}

// 4. A built dist names the same version.
const versionFile = join(root, 'dist', 'version.json');
if (existsSync(versionFile)) {
  const built = JSON.parse(readFileSync(versionFile, 'utf8')).version;
  if (built !== version) fail(`dist/version.json says ${built}, package.json ${version}`, 'rebuild: npm run build');
}

// 5. No scratch files inside the source tree (they break ESLint and leak into the public repo).
const SCRATCH = /\.tmp\.|\.scratch\.|~$|\.orig$|\.rej$/;
const walk = (dir) => {
  for (const name of readdirSync(join(root, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) walk(path);
    else if (SCRATCH.test(name)) fail(`scratch file in the repo: ${path}`, 'move it to the session scratchpad');
  }
};
for (const dir of ['src', 'tests', 'scripts', 'netlify', 'docs', 'public']) if (existsSync(join(root, dir))) walk(dir);
for (const name of readdirSync(root)) if (SCRATCH.test(name)) fail(`scratch file in the repo root: ${name}`, 'move it to the session scratchpad');

// 6. check-no-colors.mjs / check-boundaries.mjs must run to a normal pass/fail, never crash.
// Regression guard for the Windows `.pathname` drive-letter bug (docs/ops/RCA_LOG.md 2026-11-02):
// if ROOT is ever computed with `.pathname` again instead of fileURLToPath, these throw ENOENT
// on Windows instead of printing their usual OK/violation output.
for (const script of ['scripts/check-no-colors.mjs', 'scripts/check-boundaries.mjs']) {
  try {
    execFileSync('node', [script], { cwd: root, encoding: 'utf8' });
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    const isNormalFailure = /COLOR LITERALS OUTSIDE|BOUNDARY VIOLATIONS:/.test(output);
    if (!isNormalFailure) {
      fail(
        `${script} crashed instead of returning a normal pass/fail: ${output.trim().split('\n')[0] || err.message}`,
        'check how ROOT is computed — use fileURLToPath(new URL(\'..\', import.meta.url)), not .pathname (breaks on Windows)'
      );
    }
  }
}

if (problems.length > 0) {
  console.error(`doctor: ${problems.length} problem(s) for version ${version}`);
  for (const { what, fix } of problems) console.error(`  ✗ ${what}\n      fix: ${fix}`);
  process.exit(1);
}
console.log(`doctor: OK (version ${version})`);
