import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { hashReleaseAsset, verifyReleaseAssets } from './release-assets.mjs';

const exec = promisify(execFile);
const execute = (file, args) =>
  exec(file, args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });

/** Also used on registry-downloaded bytes, with the original producer identity. */
export async function verifyProducerSubject(
  path,
  context,
  { run = execute } = {},
) {
  let result;
  try {
    result = await run('gh', [
      'attestation',
      'verify',
      path,
      '--repo',
      context.repository,
      '--signer-workflow',
      `${context.repository}/.github/workflows/quality.yml`,
      '--source-ref',
      context.ref,
      '--source-digest',
      context.commit,
      '--deny-self-hosted-runners',
      '--format',
      'json',
    ]);
  } catch {
    throw new Error(
      'Producer provenance verification failed. Check the signature, repository, source, workflow and hosted-runner identity.',
    );
  }
  const receipt = JSON.parse(result.stdout);
  assert(
    receipt && typeof receipt === 'object' && Object.keys(receipt).length > 0,
    'Empty producer verification result.',
  );
  return receipt;
}

/** Verify accepted bytes against the actual hosted producer, never just a repository owner. */
export async function verifyProducerProvenance(
  root,
  context,
  { run = execute } = {},
) {
  const evidence = join(root, '.doctopus/release-verification');
  await mkdir(evidence, { recursive: true });
  const subjects = [];
  for (const kind of ['npm', 'java', 'container']) {
    const directory = join(root, '.doctopus/release-assets', kind);
    const manifest = await verifyReleaseAssets(directory, context, kind);
    for (const name of [
      ...manifest.files.map((entry) => entry.name),
      'release-assets.json',
    ]) {
      const path = join(directory, name);
      const receipt = await verifyProducerSubject(path, context, { run });
      await writeFile(
        join(evidence, `${kind}-${name}.json`),
        JSON.stringify(receipt, null, 2) + '\n',
        { flag: 'wx' },
      );
      subjects.push({ kind, name, ...(await hashReleaseAsset(path)) });
    }
  }
  return {
    context,
    subjects,
    producerWorkflow: `${context.repository}/.github/workflows/quality.yml`,
  };
}
