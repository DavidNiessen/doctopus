import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import { validatePreparedPerformance } from './lib/prepared-performance.mjs';

const scenario = process.argv[2];
assert(
  process.argv.length === 3 && ['compiler', 'browser'].includes(scenario),
  'Choose compiler or browser',
);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
let path = '.doctopus/benchmark-report.json';
if (scenario === 'browser') {
  const root = '.doctopus/browser-benchmark';
  const entries = await readdir(root, { withFileTypes: true });
  const runs = entries.filter((entry) => entry.isDirectory());
  assert.equal(runs.length, 1, 'Run prepared performance in a fresh checkout');
  path = join(root, runs[0].name, 'report.json');
}
validatePreparedPerformance(JSON.parse(await readFile(path, 'utf8')), {
  scenario,
  toolVersion,
  commit,
});
console.log(
  `Prepared ${scenario} performance matches the tool, artifact, source, fixture and budgets.`,
);
