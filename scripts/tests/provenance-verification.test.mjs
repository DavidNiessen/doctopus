import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hashReleaseAsset,
  writeReleaseAssetManifest,
} from '../lib/release-assets.mjs';
import { verifyProducerProvenance } from '../lib/provenance-verification.mjs';

const context = {
  repository: 'DavidNiessen/doctopus',
  commit: 'a'.repeat(40),
  version: '0.2.0',
  ref: 'refs/tags/v0.2.0',
  runId: '123',
  runAttempt: '1',
};
async function fixture(t) {
  const root = await mkdtemp(
    join(tmpdir(), 'doctopus-provenance-verification-'),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const kind of ['npm', 'java', 'container']) {
    const dir = join(root, '.doctopus/release-assets', kind);
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'archive.bin');
    await writeFile(path, 'exact bytes');
    await writeReleaseAssetManifest(
      dir,
      kind,
      context,
      [{ name: 'archive.bin', ...(await hashReleaseAsset(path)) }],
      kind === 'container' ? 'sha256:' + 'b'.repeat(64) : undefined,
    );
  }
  return root;
}

test('the verifier invokes all producer/source constraints for every subject and records successful results', async (t) => {
  const root = await fixture(t),
    calls = [];
  const proof = await verifyProducerProvenance(root, context, {
    run: async (file, args) => {
      assert.equal(file, 'gh');
      assert.deepEqual(args.slice(0, 2), ['attestation', 'verify']);
      assert.deepEqual(args.slice(3), [
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
      calls.push(args[2]);
      return { stdout: '[{"unitTestVerifierResult":true}]' };
    },
  });
  assert.equal(calls.length, 6);
  assert.equal(proof.subjects.length, 6);
  assert.equal(
    (await readdir(join(root, '.doctopus/release-verification'))).length,
    6,
  );
});

test('changed artifacts fail before invoking a verifier and verifier errors or empty results never count as success', async (t) => {
  const root = await fixture(t);
  const archive = join(root, '.doctopus/release-assets/npm/archive.bin');
  await writeFile(archive, 'tampered');
  let called = false;
  await assert.rejects(
    verifyProducerProvenance(root, context, {
      run: async () => {
        called = true;
        return { stdout: '[{}]' };
      },
    }),
    /checksum/,
  );
  assert.equal(called, false);
  await writeFile(archive, 'exact bytes');
  await assert.rejects(
    verifyProducerProvenance(root, context, {
      run: async () => {
        throw new Error('simulated failure');
      },
    }),
    /Producer provenance verification failed/,
  );
  for (const stdout of ['[]', '{}', 'null', 'not-json'])
    await assert.rejects(
      verifyProducerProvenance(root, context, {
        run: async () => ({ stdout }),
      }),
    );
});
