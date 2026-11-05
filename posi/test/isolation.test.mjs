import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Meeting notice removed at owner request; the AI assistant remains isolated.
const BASELINE = '545b5593737c090c5f4c11aa30fe844e41cb6cd6';
const protectedPaths = ['public', 'src', 'migrations', 'migration', 'wrangler.jsonc', 'package.json', 'package-lock.json', 'AGENTS.md'];
const git = (args, options = {}) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options });
const nulList = bytes => bytes.toString('utf8').split('\0').filter(Boolean);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('production assets, source, schema and root configuration remain byte-identical to audited baseline', async () => {
  const baseline = nulList(git(['ls-tree', '-r', '--name-only', '-z', BASELINE, '--', ...protectedPaths]));
  assert.ok(baseline.length > 100, 'baseline must include real production assets');
  const current = nulList(git(['ls-files', '-z', '--', ...protectedPaths]));
  assert.deepEqual(current.sort(), [...baseline].sort(), 'no tracked production file is added or removed');
  const untracked = nulList(git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...protectedPaths]));
  assert.deepEqual(untracked, [], 'no untracked POSI injection or production files');
  // Read all pinned blobs in one Git process, preserving exact binary bytes.
  const blobs = git(['cat-file', '--batch'], { input: baseline.map(file => `${BASELINE}:${file}`).join('\n') + '\n' });
  let offset = 0;
  for (const file of baseline) {
    const headerEnd = blobs.indexOf(10, offset);
    const header = blobs.subarray(offset, headerEnd).toString('utf8');
    assert.match(header, /^[a-f0-9]+ blob \d+$/, file);
    const length = Number(header.split(' ')[2]);
    const before = blobs.subarray(headerEnd + 1, headerEnd + 1 + length);
    offset = headerEnd + length + 2;
    const after = await readFile(new URL(file, new URL('../../', import.meta.url)));
    assert.equal(digest(after), digest(before), `production file changed: ${file}`);
  }
  assert.equal(offset, blobs.length);
});

test('staging Worker cannot route production or access order storage', async () => {
  // This dedicated config deliberately uses JSON-compatible JSONC.
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.name, 'new-posi-staging');
  assert.notEqual(config.name, 'new');
  assert.deepEqual(config.routes, []);
  assert.equal(config.vars.POSI_ENABLED, 'false');
  assert.equal(config.vars.POSI_AI_ENABLED, 'false');
  assert.deepEqual(config.ai, { binding: 'AI' });
  assert.equal(config.vars.POSI_AI_DAILY_LIMIT, '100');
  assert.deepEqual(config.durable_objects, { bindings: [{ name: 'POSI_AI_BUDGET', class_name: 'PosiAiBudget' }] });
  assert.deepEqual(config.migrations, [{ tag: 'posi-ai-budget-v1', new_sqlite_classes: ['PosiAiBudget'] }]);
  for (const key of ['d1_databases', 'r2_buckets', 'services', 'kv_namespaces', 'dispatch_namespaces', 'unsafe']) {
    assert.ok(!config[key] || (Array.isArray(config[key]) && config[key].length === 0), `unexpected binding: ${key}`);
  }
  const allowed = config.vars.POSI_ALLOWED_ORIGINS.split(',');
  for (const value of allowed) {
    const origin = new URL(value.trim());
    assert.ok(['localhost', '127.0.0.1', '[::1]', 'new-posi-staging.yudhi7208.workers.dev'].includes(origin.hostname), 'default CORS must remain local or the dedicated staging origin');
    assert.equal(origin.origin, value.trim());
    assert.ok(!origin.hostname.endsWith('posloker.my.id'));
  }
  assert.equal(config.assets.directory, './.preview-public', 'staging must not serve or rewrite production public/');
});

test('preview bridge is absent from production page and script entry points', async () => {
  for (const file of ['public/pembayaran/index.html', 'public/checkout/checkout.js', 'public/index.html', 'src/worker.mjs', 'wrangler.jsonc']) {
    const source = await readFile(new URL('../../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:posi\/|api\/posi|POSI_ENABLED|bootPosi|createCheckoutAdapter)/, file);
  }
});
