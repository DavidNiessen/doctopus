import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseCommand } from './release-command.mjs';
import { releaseRequest } from './release-http.mjs';
import { verifyReleaseAssets } from './release-assets.mjs';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
export const promotionPredicateType =
  'https://github.com/DavidNiessen/doctopus/attestations/promotion/v1';

function repositoryPath(repository) {
  assert.match(
    repository,
    /^ghcr\.io\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/,
  );
  return repository.slice('ghcr.io/'.length);
}

export async function ghcrAuthorization(
  repository,
  { username, token, request = releaseRequest } = {},
) {
  const path = repositoryPath(repository);
  const authenticated = typeof token === 'string' && token.length > 0;
  if (authenticated)
    assert(
      typeof username === 'string' &&
        /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}(?:\[bot\])?$/.test(username),
    );
  const result = await request(
    `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${path}:${authenticated ? 'pull,push' : 'pull'}`)}`,
    {
      headers: authenticated
        ? {
            Authorization:
              'Basic ' + Buffer.from(`${username}:${token}`).toString('base64'),
          }
        : {},
    },
  );
  assert.equal(
    result.status,
    200,
    'Cannot authorize the intended GHCR repository.',
  );
  const value = JSON.parse(result.bytes.toString('utf8')).token;
  assert(
    typeof value === 'string' && value.length > 0 && value.length <= 65536,
  );
  return value;
}

/** Bind the registry manifest's actual digest and config ID to the accepted Docker image. */
export async function inspectGhcrManifest(
  repository,
  reference,
  authorization,
  { request = releaseRequest } = {},
) {
  const path = repositoryPath(repository);
  assert(
    digestPattern.test(reference) ||
      /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(reference),
  );
  const result = await request(
    `https://ghcr.io/v2/${path}/manifests/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${authorization}`,
        Accept:
          'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
      },
    },
  );
  if (result.status === 404) return { exists: false };
  assert.equal(
    result.status,
    200,
    'Cannot inspect the intended GHCR manifest.',
  );
  const digest =
    'sha256:' + createHash('sha256').update(result.bytes).digest('hex');
  assert.equal(
    result.contentDigest,
    digest,
    'GHCR manifest digest differs from its bytes.',
  );
  if (digestPattern.test(reference)) assert.equal(digest, reference);
  const manifest = JSON.parse(result.bytes.toString('utf8'));
  assert.equal(manifest.schemaVersion, 2);
  assert(
    [
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.docker.distribution.manifest.v2+json',
    ].includes(manifest.mediaType),
  );
  assert.match(manifest.config?.digest, digestPattern);
  assert(Array.isArray(manifest.layers) && manifest.layers.length > 0);
  return { exists: true, digest, image: manifest.config.digest };
}

/** The advertised version tag and digest must both resolve to the accepted public image. */
export async function verifyPublicGhcrImage(
  candidate,
  digest,
  { request = releaseRequest } = {},
) {
  assert.match(digest, digestPattern);
  const token = await ghcrAuthorization(candidate.repository, { request });
  const tagged = await inspectGhcrManifest(
    candidate.repository,
    candidate.tag,
    token,
    { request },
  );
  assert(tagged.exists, 'The advertised container version is not public.');
  assert.equal(
    tagged.digest,
    digest,
    'The advertised container version changed after publication.',
  );
  assert.equal(tagged.image, candidate.image);
  const immutable = await inspectGhcrManifest(
    candidate.repository,
    digest,
    token,
    { request },
  );
  assert(immutable.exists);
  assert.equal(immutable.image, candidate.image);
  return immutable;
}

export async function loadContainerPublication(root, context, plan) {
  assert.equal(plan.policyApproved, true);
  for (const key of [
    'repository',
    'commit',
    'ref',
    'version',
    'runId',
    'runAttempt',
  ])
    assert.equal(plan[key], context[key]);
  repositoryPath(plan.container.repository);
  assert.equal(plan.container.tag, context.version);
  const directory = join(root, '.doctopus/release-assets/container');
  const manifest = await verifyReleaseAssets(directory, context, 'container');
  const archive = manifest.files.find((file) => file.name === 'server.tar.gz');
  assert(archive);
  return {
    directory,
    context,
    repository: plan.container.repository,
    tag: context.version,
    image: manifest.image,
    archive,
  };
}

/** Select only the managed local daemon; keep inherited proxies, CA and credentials intact. */
export async function runReleaseDocker(
  config,
  args,
  { input, env = process.env } = {},
) {
  const environment = { ...env };
  for (const name of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete environment[name];
  try {
    return await releaseCommand(
      'docker',
      ['--config', config, '--host=unix:///var/run/docker.sock', ...args],
      {
        env: environment,
        timeout: 300_000,
        maxBuffer: 4 * 1024 * 1024,
        input,
      },
    );
  } catch {
    throw new Error(
      'Release Docker command failed. Check the local daemon, registry authorization and retained publication receipts.',
    );
  }
}

export async function publishContainerArchive(
  candidate,
  {
    env = process.env,
    request = releaseRequest,
    run = runReleaseDocker,
    receiptPath,
  } = {},
) {
  assert(
    env.GHCR_TOKEN,
    'The protected GHCR publishing step requires its scoped GitHub token.',
  );
  const authorization = await ghcrAuthorization(candidate.repository, {
    username: env.GITHUB_ACTOR,
    token: env.GHCR_TOKEN,
    request,
  });
  let remote = await inspectGhcrManifest(
    candidate.repository,
    candidate.tag,
    authorization,
    { request },
  );
  const reused = remote.exists;
  if (remote.exists)
    assert.equal(
      remote.image,
      candidate.image,
      'The immutable GHCR tag already points to a different image.',
    );
  const config = await mkdtemp(join(tmpdir(), 'ad-ghcr-'));
  try {
    if (!remote.exists) {
      await run(
        config,
        [
          'login',
          'ghcr.io',
          '--username',
          env.GITHUB_ACTOR,
          '--password-stdin',
        ],
        { env, input: env.GHCR_TOKEN },
      );
      await run(
        config,
        [
          'image',
          'load',
          '--input',
          join(candidate.directory, candidate.archive.name),
        ],
        { env },
      );
      const loaded = await run(
        config,
        ['image', 'inspect', '--format', '{{.Id}}', candidate.image],
        { env },
      );
      assert.equal(
        loaded.stdout.trim(),
        candidate.image,
        'Loaded image differs from the tested image.',
      );
      const platform = await run(
        config,
        [
          'image',
          'inspect',
          '--format',
          '{{.Os}}/{{.Architecture}}',
          candidate.image,
        ],
        { env },
      );
      assert.equal(
        platform.stdout.trim(),
        'linux/amd64',
        'Only the tested image platform may be published.',
      );
      const target = `${candidate.repository}:${candidate.tag}`;
      await run(config, ['image', 'tag', candidate.image, target], { env });
      await run(
        config,
        ['image', 'push', '--platform', 'linux/amd64', target],
        { env },
      );
      remote = await inspectGhcrManifest(
        candidate.repository,
        candidate.tag,
        authorization,
        { request },
      );
      assert(remote.exists);
      assert.equal(
        remote.image,
        candidate.image,
        'Published GHCR image differs from the tested image.',
      );
    }
    const predicate = {
      schemaVersion: 1,
      ...candidate.context,
      producerWorkflow: `${candidate.context.repository}/.github/workflows/quality.yml`,
      archiveSha256: candidate.archive.sha256,
      image: candidate.image,
      containerRepository: candidate.repository,
      digest: remote.digest,
    };
    if (receiptPath)
      await writeFile(
        receiptPath,
        JSON.stringify(
          {
            ...predicate,
            complete: true,
            reused,
            promotionAttestationVerified: false,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
    return { ...remote, predicate, reused };
  } finally {
    await rm(config, { recursive: true, force: true });
  }
}

/** Remove the exact owned probe even when its process times out or validation fails. */
export async function probePublishedContainer(
  config,
  reference,
  version,
  { run = runReleaseDocker } = {},
) {
  const name = 'doctopus-public-probe-' + randomUUID();
  await run(config, [
    'container',
    'create',
    '--name',
    name,
    '--network',
    'none',
    '--read-only',
    '--user',
    '1000:1000',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '64',
    '--memory',
    '256m',
    '--cpus',
    '1',
    '--entrypoint',
    'node',
    reference,
    '--input-type=module',
    '-e',
    "import {toolVersion} from '@davidniessen/doctopus-contracts'; process.stdout.write(JSON.stringify({uid:process.getuid(),toolVersion,node:process.version}));",
  ]);
  try {
    const probe = await run(config, ['container', 'start', '--attach', name]);
    const runtime = JSON.parse(probe.stdout);
    assert.equal(runtime.uid, 1000);
    assert.equal(runtime.toolVersion, version);
    return runtime;
  } finally {
    await run(config, ['container', 'rm', '--force', name]);
  }
}
