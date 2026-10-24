import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readRegularFile } from './lib/read-regular-file.mjs';
import { releaseSource } from './lib/release-assets.mjs';
import {
  loadGitHubMavenPublication,
  publishGitHubMaven,
} from './lib/github-maven-publication.mjs';

assert.equal(process.argv.length, 2);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: 'release-publish.yml',
});
const plan = JSON.parse(
  await readRegularFile(join(root, '.doctopus/publication/plan.json')),
);
assert.equal(plan.publicationRunId, source.runId);
assert.equal(plan.publicationRunAttempt, source.runAttempt);
assert(plan.environmentProtection?.reviewers > 0);
assert.equal(plan.environmentProtection.tagPolicy, 'v*');
const context = { ...source, runId: plan.runId, runAttempt: plan.runAttempt };
const candidate = await loadGitHubMavenPublication(root, context, plan);
const output = join(root, '.doctopus/publication/maven');
await mkdir(output, { recursive: true });
await publishGitHubMaven(candidate, {
  root,
  receiptPath: join(output, 'result.json'),
});
assert.deepEqual(
  await releaseSource(root, process.env, { workflow: 'release-publish.yml' }),
  source,
);
console.log(
  'Exact accepted Maven files are in GitHub Packages. Fresh authenticated consumer acceptance remains required.',
);
