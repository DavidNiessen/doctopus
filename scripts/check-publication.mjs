import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  publicationPlan,
  validateCandidateRun,
} from './lib/publication-policy.mjs';
import { inspectPublicationProtections } from './lib/publication-protection.mjs';
import { verifyProducerProvenance } from './lib/provenance-verification.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';
import { releaseSource } from './lib/release-assets.mjs';
import {
  readRepositoryFile,
  readWorkspacePackages,
} from './lib/workspaces.mjs';

const args = process.argv.slice(2);
const runId = args.shift(),
  runAttempt = args.shift();
assert.match(runId ?? '', /^[1-9][0-9]{0,19}$/);
assert.match(runAttempt ?? '', /^[1-9][0-9]{0,19}$/);
const requireApproval = args.length === 1 && args[0] === '--require-approval';
assert(
  args.length === 0 || requireApproval,
  'Use check-publication.mjs RUN_ID RUN_ATTEMPT [--require-approval].',
);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: 'release-publish.yml',
});
const context = { ...source, runId, runAttempt };
const exec = promisify(execFile);
async function api(path) {
  try {
    const result = await exec(
      'gh',
      ['api', `repos/${source.repository}${path ? '/' + path : ''}`],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Cannot verify GitHub release metadata: ${path}. Check the repository connection and API permissions.`,
    );
  }
}
const [run, workflow, tag] = await Promise.all([
  api(`actions/runs/${runId}`),
  api('actions/workflows/release-candidate.yml'),
  api(`git/ref/tags/v${source.version}`),
]);
validateCandidateRun(run, context, workflow.id);
assert.equal(tag.ref, context.ref);
let object = tag.object;
for (let count = 0; object.type === 'tag'; count++) {
  assert(count < 4, 'Excessively nested annotated release tag.');
  assert.match(object.sha, /^[a-f0-9]{40}$/);
  object = (await api(`git/tags/${object.sha}`)).object;
}
assert.equal(object.type, 'commit');
assert.equal(object.sha, source.commit, 'Remote release tag changed.');
const proof = await verifyProducerProvenance(root, context);
const packages = (await readWorkspacePackages(root))
  .filter((pkg) => pkg.path && pkg.metadata.private !== true)
  .map((pkg) => pkg.metadata.name);
const pom = await readRepositoryFile(root, 'integrations/java/pom.xml');
const mavenGroup = pom.match(/<groupId>([^<]+)<\/groupId>/)?.[1];
const policy = JSON.parse(
  await readRegularFile(join(root, 'release-policy.json')),
);
const plan = publicationPlan(policy, context, { packages, mavenGroup });
let environment, repositoryProtection;
if (requireApproval) {
  assert.equal(plan.policyApproved, true, plan.blockers.join(' '));
  const inspected = await inspectPublicationProtections(
    root,
    source.repository,
    api,
  );
  environment = inspected.environmentProtection;
  repositoryProtection = inspected.repositoryProtection;
}
assert.deepEqual(
  await releaseSource(root, process.env, { workflow: 'release-publish.yml' }),
  source,
);
await mkdir('.doctopus/publication', { recursive: true });
await writeFile(
  '.doctopus/publication/plan.json',
  JSON.stringify(
    {
      ...plan,
      publicationRunId: source.runId,
      publicationRunAttempt: source.runAttempt,
      proof,
      ...(environment ? { environmentProtection: environment } : {}),
      ...(repositoryProtection ? { repositoryProtection } : {}),
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify(
    {
      candidate: `${runId}/${runAttempt}`,
      version: source.version,
      verifiedSubjects: proof.subjects.length,
      policyApproved: plan.policyApproved,
      publicationApproved: false,
      blockers: plan.blockers,
    },
    null,
    2,
  ),
);
