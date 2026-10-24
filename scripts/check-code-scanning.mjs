import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessCodeScanning } from './lib/code-scanning.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';

const files = process.argv.slice(2);
assert(
  files.length > 0 && files.length <= 8,
  'Supply current CodeQL SARIF files.',
);
assert.equal(new Set(files.map((file) => resolve(file))).size, files.length);
const results = [];
for (const file of files) {
  const bytes = await readRegularFile(file, 64 * 1024 * 1024);
  results.push({
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    assessment: assessCodeScanning(JSON.parse(bytes)),
  });
}
const report = {
  schemaVersion: 1,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  passed: results.every((result) => result.assessment.passed),
  results,
};
await mkdir('.doctopus', { recursive: true });
await writeFile(
  '.doctopus/code-scanning-evidence.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
