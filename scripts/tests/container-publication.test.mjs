import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ghcrAuthorization,
  inspectGhcrManifest,
  probePublishedContainer,
  publishContainerArchive,
  verifyPublicGhcrImage,
} from '../lib/container-publication.mjs';

const image = 'sha256:' + 'a'.repeat(64);
const repository = 'ghcr.io/davidniessen/doctopus';
const raw = Buffer.from(
  JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { digest: image },
    layers: [{ digest: 'sha256:' + 'b'.repeat(64) }],
  }),
);
const manifest = () => ({
  status: 200,
  bytes: raw,
  contentDigest: 'sha256:' + createHash('sha256').update(raw).digest('hex'),
});
const missing = { status: 404, bytes: Buffer.from('missing') };
const auth = {
  status: 200,
  bytes: Buffer.from('{"token":"unit-test-registry-token"}'),
};
const candidate = {
  directory: '/unit-test-fixture',
  repository,
  tag: '0.2.0',
  image,
  archive: { name: 'server.tar.gz', sha256: 'c'.repeat(64) },
  context: {
    repository: 'DavidNiessen/doctopus',
    commit: 'd'.repeat(40),
    ref: 'refs/tags/v0.2.0',
    version: '0.2.0',
    runId: '123',
    runAttempt: '1',
  },
};

test('GHCR anonymous checks request only public pull scope and never inherit publisher credentials', async () => {
  const value = await ghcrAuthorization(repository, {
    request: async (url, options) => {
      assert.equal(
        new URL(url).searchParams.get('scope'),
        'repository:davidniessen/doctopus:pull',
      );
      assert.deepEqual(options.headers, {});
      return auth;
    },
  });
  assert.equal(value, 'unit-test-registry-token');
  await assert.rejects(ghcrAuthorization('attacker.example/owner/image'));
  await assert.rejects(
    ghcrAuthorization(repository, {
      request: async () => ({ ...auth, status: 403 }),
    }),
  );
});

test('GHCR publishing supports GitHub App actor names while rejecting invalid Basic authentication usernames', async () => {
  const token = 'unit-test-publisher-token';
  const username = 'release-automation[bot]';
  await ghcrAuthorization(repository, {
    username,
    token,
    request: async (_url, options) => {
      assert.equal(
        options.headers.Authorization,
        'Basic ' + Buffer.from(username + ':' + token).toString('base64'),
      );
      return auth;
    },
  });
  await assert.rejects(
    ghcrAuthorization(repository, {
      username: 'invalid:user',
      token,
      request: async () => {
        throw new Error('Must not request');
      },
    }),
  );
});

test('GHCR binds actual manifest bytes, immutable digest and config identity', async () => {
  const result = await inspectGhcrManifest(
    repository,
    '0.2.0',
    'unit-test-registry-token',
    { request: async () => manifest() },
  );
  assert.equal(result.image, image);
  assert.equal(
    (
      await inspectGhcrManifest(
        repository,
        result.digest,
        'unit-test-registry-token',
        { request: async () => manifest() },
      )
    ).digest,
    result.digest,
  );
  assert.equal(
    (
      await inspectGhcrManifest(
        repository,
        '0.2.0',
        'unit-test-registry-token',
        { request: async () => missing },
      )
    ).exists,
    false,
  );
  await assert.rejects(
    inspectGhcrManifest(
      repository,
      'sha256:' + 'f'.repeat(64),
      'unit-test-registry-token',
      { request: async () => manifest() },
    ),
  );
  await assert.rejects(
    inspectGhcrManifest(repository, '0.2.0', 'unit-test-registry-token', {
      request: async () => ({
        ...manifest(),
        contentDigest: 'sha256:' + 'f'.repeat(64),
      }),
    }),
  );
});

test('container publication loads the exact archive, pushes the tested config and removes only its private credentials', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ad-oci-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receiptPath = join(root, 'receipt.json');
  let pushed = false,
    config;
  const calls = [];
  const result = await publishContainerArchive(candidate, {
    env: {
      GHCR_TOKEN: 'unit-test-publisher-token',
      GITHUB_ACTOR: 'DavidNiessen',
    },
    receiptPath,
    request: async (url, options) => {
      if (url.includes('/token?')) {
        assert(options.headers.Authorization.startsWith('Basic '));
        return auth;
      }
      return pushed ? manifest() : missing;
    },
    run: async (directory, args, options) => {
      config = directory;
      calls.push(args);
      assert(!JSON.stringify(args).includes('unit-test-publisher-token'));
      if (args[0] === 'login')
        assert.equal(options.input, 'unit-test-publisher-token');
      if (args[1] === 'load')
        assert.equal(
          args.at(-1),
          join(candidate.directory, candidate.archive.name),
        );
      if (args[1] === 'push') pushed = true;
      return { stdout: args.includes('{{.Id}}') ? image : 'linux/amd64' };
    },
  });
  assert.equal(result.reused, false);
  const push = calls.find((args) => args[1] === 'push');
  assert.deepEqual(push.slice(2, 4), ['--platform', 'linux/amd64']);
  assert.deepEqual(
    calls.map((args) => (args[0] === 'login' ? 'login' : args[1])),
    ['login', 'load', 'inspect', 'inspect', 'tag', 'push'],
  );
  assert.equal(result.predicate.repository, 'DavidNiessen/doctopus');
  assert.equal(result.predicate.containerRepository, repository);
  assert.equal(result.predicate.archiveSha256, candidate.archive.sha256);
  await assert.rejects(access(config));
  assert(
    !(await readFile(receiptPath, 'utf8')).includes(
      'unit-test-publisher-token',
    ),
  );
});

test('public container acceptance checks the advertised tag as well as its immutable digest', async () => {
  const requested = [];
  const request = async (url, options) => {
    requested.push(url);
    if (url.includes('/token?')) {
      assert.deepEqual(options.headers, {});
      return auth;
    }
    return manifest();
  };
  const digest = manifest().contentDigest;
  assert.equal(
    (await verifyPublicGhcrImage(candidate, digest, { request })).image,
    image,
  );
  assert(requested.some((url) => url.endsWith('/manifests/0.2.0')));
  assert(requested.some((url) => url.endsWith('/manifests/' + digest)));
  await assert.rejects(
    verifyPublicGhcrImage(candidate, 'sha256:' + 'f'.repeat(64), { request }),
    /changed after publication/,
  );
});

test('matching GHCR versions are reused and conflicting versions fail before a Docker command', async () => {
  let calls = 0;
  const options = {
    env: {
      GHCR_TOKEN: 'unit-test-publisher-token',
      GITHUB_ACTOR: 'DavidNiessen',
    },
    request: async (url) => (url.includes('/token?') ? auth : manifest()),
    run: async () => {
      calls++;
    },
  };
  assert.equal(
    (await publishContainerArchive(candidate, options)).reused,
    true,
  );
  await assert.rejects(
    publishContainerArchive(
      { ...candidate, image: 'sha256:' + 'e'.repeat(64) },
      options,
    ),
    /different image/,
  );
  assert.equal(calls, 0);
});

test('an archive that loads a different config never reaches tagging or publication', async () => {
  const calls = [];
  await assert.rejects(
    publishContainerArchive(candidate, {
      env: {
        GHCR_TOKEN: 'unit-test-publisher-token',
        GITHUB_ACTOR: 'DavidNiessen',
      },
      request: async (url) => (url.includes('/token?') ? auth : missing),
      run: async (_config, args) => {
        calls.push(args);
        return { stdout: 'sha256:' + 'f'.repeat(64) };
      },
    }),
    /Loaded image differs/,
  );
  assert(!calls.some((args) => args.includes('push') || args.includes('tag')));
});

test('a failed or successful public runtime probe always removes only its allocated container', async () => {
  for (const fails of [false, true]) {
    const calls = [];
    let name;
    const operation = probePublishedContainer(
      '/unit-fixture',
      repository + '@' + manifest().contentDigest,
      '0.2.0',
      {
        run: async (_config, args) => {
          calls.push(args);
          if (args[1] === 'create') {
            name = args[args.indexOf('--name') + 1];
            assert.match(name, /^doctopus-public-probe-[a-f0-9-]+$/);
            assert(args.includes('--read-only'));
          }
          if (args[1] === 'start' && fails) throw new Error('fixture timeout');
          return { stdout: '{"uid":1000,"toolVersion":"0.2.0"}' };
        },
      },
    );
    if (fails) await assert.rejects(operation, /fixture timeout/);
    else assert.equal((await operation).uid, 1000);
    assert.deepEqual(calls.at(-1), ['container', 'rm', '--force', name]);
  }
});
