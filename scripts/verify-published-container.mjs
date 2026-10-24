import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  loadContainerPublication,
  probePublishedContainer,
  promotionPredicateType,
  runReleaseDocker,
  verifyPublicGhcrImage,
} from './lib/container-publication.mjs';
import { releaseSource } from './lib/release-assets.mjs';
import { readRegularFile } from './lib/read-regular-file.mjs';

assert.equal(process.argv.length, 2);
const root = process.cwd();
const source = await releaseSource(root, process.env, {
  workflow: 'release-publish.yml',
});
const plan = JSON.parse(
  await readRegularFile(join(root, '.doctopus/publication/plan.json')),
);
const context = { ...source, runId: plan.runId, runAttempt: plan.runAttempt };
const candidate = await loadContainerPublication(root, context, plan);
const receipt = JSON.parse(
  await readRegularFile(
    join(root, '.doctopus/publication/container-result.json'),
  ),
);
for (const [key, value] of Object.entries(context))
  assert.equal(receipt[key], value);
assert.equal(receipt.complete, true);
assert.equal(receipt.image, candidate.image);
assert.equal(receipt.containerRepository, candidate.repository);
assert.equal(receipt.archiveSha256, candidate.archive.sha256);
assert.match(receipt.digest, /^sha256:[a-f0-9]{64}$/);
// Deliberately request an anonymous pull token, even when GH_TOKEN is set for attestation reads.
const remote = await verifyPublicGhcrImage(candidate, receipt.digest);
assert(remote.exists, 'The published image must be publicly accessible.');
assert.equal(remote.image, candidate.image);
const config = await mkdtemp(join(tmpdir(), 'ad-public-oci-'));
const output = join(root, '.doctopus/published-consumers/container');
await mkdir(output, { recursive: true });
try {
  const reference = `${candidate.repository}@${receipt.digest}`;
  await runReleaseDocker(config, ['image', 'pull', reference]);
  const image = await runReleaseDocker(config, [
    'image',
    'inspect',
    '--format',
    '{{.Id}}',
    reference,
  ]);
  assert.equal(image.stdout.trim(), candidate.image);
  const exec = promisify(execFile);
  const signature = await exec(
    'gh',
    [
      'attestation',
      'verify',
      `oci://${reference}`,
      '--repo',
      context.repository,
      '--signer-workflow',
      `${context.repository}/.github/workflows/release-publish.yml`,
      '--source-ref',
      context.ref,
      '--source-digest',
      context.commit,
      '--deny-self-hosted-runners',
      '--predicate-type',
      promotionPredicateType,
      '--format',
      'json',
    ],
    { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const verified = JSON.parse(signature.stdout);
  assert(
    verified &&
      typeof verified === 'object' &&
      Object.keys(verified).length > 0,
  );
  await writeFile(
    join(output, 'promotion-verification.json'),
    JSON.stringify(verified, null, 2) + '\n',
    { flag: 'wx' },
  );
  const runtime = await probePublishedContainer(
    config,
    reference,
    context.version,
  );
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        ...context,
        passed: true,
        image: candidate.image,
        digest: receipt.digest,
        runtime,
        checks: [
          'anonymous-registry-manifest',
          'anonymous-digest-pull',
          'tested-config-id',
          'keyless-promotion-attestation',
          'unprivileged-readonly-offline-runtime',
        ],
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    'Anonymous container pull, exact tested image ID, promotion attestation and runtime identity passed.',
  );
} finally {
  await rm(config, { recursive: true, force: true });
}
