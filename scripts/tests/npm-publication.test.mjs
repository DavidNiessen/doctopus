import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  inspectNpmVersion,
  publishNpmArchives,
} from '../lib/npm-publication.mjs';
import { releaseRequest } from '../lib/release-http.mjs';

const bytes = Buffer.from(
  'test fixture archive bytes, not a published package',
);
const pkg = {
  name: '@davidniessen/doctopus-contracts',
  version: '0.2.0',
  filename: 'doctopus-contracts-0.2.0.tgz',
  bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
};
const tarball =
  'https://registry.npmjs.org/@davidniessen/doctopus-contracts/-/contracts-0.2.0.tgz';
const metadata = () => ({
  name: pkg.name,
  version: pkg.version,
  dist: {
    integrity: pkg.integrity,
    tarball,
    attestations: {
      url: 'https://registry.npmjs.org/-/npm/v1/attestations/@davidniessen%2fcontracts@0.2.0',
      provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
    },
  },
});
const response = (value, status = 200) => ({
  status,
  bytes: Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)),
});

test('npm destinations reject lookalike hosts and URLs containing an allowed registry name before any request', async () => {
  for (const registry of [
    'https://registry.npmjs.org.attacker.example',
    'https://attacker.example/https://registry.npmjs.org',
    'https://npm.pkg.github.com.attacker.example',
  ]) {
    let requests = 0;
    await assert.rejects(
      inspectNpmVersion(pkg, {
        registry,
        request: async () => {
          requests++;
          throw new Error('Must not request');
        },
      }),
      /Unexpected npm registry/,
    );
    assert.equal(requests, 0);
  }
});

test('immutable npm version reuse requires matching metadata and actual public archive bytes', async () => {
  const request = async (url) => response(url === tarball ? bytes : metadata());
  assert.equal((await inspectNpmVersion(pkg, { request })).exists, true);
  assert.equal(
    (await inspectNpmVersion(pkg, { request: async () => response({}, 404) }))
      .exists,
    false,
  );
  for (const bad of [
    { ...metadata(), name: '@someone/else' },
    { ...metadata(), version: '0.3.0' },
    { ...metadata(), dist: { integrity: 'another-integrity', tarball } },
    {
      ...metadata(),
      dist: {
        integrity: pkg.integrity,
        tarball: 'https://untrusted.example/archive.tgz',
        attestations: metadata().dist.attestations,
      },
    },
  ])
    await assert.rejects(
      inspectNpmVersion(pkg, { request: async () => response(bad) }),
    );
  await assert.rejects(
    inspectNpmVersion(pkg, {
      request: async (url) =>
        response(url === tarball ? Buffer.alloc(bytes.length) : metadata()),
    }),
    /differs/,
  );
  await assert.rejects(
    inspectNpmVersion(pkg, { request: async () => response({}, 403) }),
    /Cannot inspect/,
  );
});

test('npm preflights every package before any write and refuses a conflicting later version', async () => {
  let writes = 0;
  await assert.rejects(
    publishNpmArchives(
      {
        directory: '/unused',
        tag: 'next',
        packages: [pkg, { ...pkg, version: '0.3.0' }],
      },
      {
        request: async (url) =>
          url.endsWith('/0.2.0') ? response({}, 404) : response(metadata()),
        run: async () => {
          writes++;
        },
      },
    ),
  );
  assert.equal(writes, 0);
});

test('npm uses the archive, disables scripts and retains token-free receipts and resumable results', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-npm-publish-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let published = false,
    calls = 0,
    privateRoot;
  const receiptPath = join(root, 'receipt.json');
  const request = async (url) =>
    response(
      url === tarball ? bytes : published ? metadata() : {},
      published ? 200 : 404,
    );
  const candidate = { directory: root, tag: 'next', packages: [pkg] };
  const result = await publishNpmArchives(candidate, {
    request,
    receiptPath,
    env: { NPM_TOKEN: 'unit-test-only-not-a-credential' },
    run: async (file, args, options) => {
      calls++;
      privateRoot = options.cwd;
      assert.equal(file, 'npm');
      assert.equal(args[0], 'publish');
      assert.equal(args[1], join(root, pkg.filename));
      for (const flag of [
        '--ignore-scripts',
        '--provenance',
        '--access',
        '--registry',
        '--userconfig',
      ])
        assert(args.includes(flag));
      assert(!JSON.stringify(args).includes('unit-test-only-not-a-credential'));
      assert.equal(
        await readFile(args[args.indexOf('--userconfig') + 1], 'utf8'),
        '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n',
      );
      published = true;
    },
  });
  assert.equal(result.complete, true);
  assert.equal(result.packages[0].reused, false);
  assert.equal(calls, 1);
  await assert.rejects(access(privateRoot));
  assert(
    !(await readFile(receiptPath, 'utf8')).includes(
      'unit-test-only-not-a-credential',
    ),
  );
  const reused = await publishNpmArchives(candidate, {
    request,
    env: {},
    run: async () => {
      throw Error('Must not republish');
    },
  });
  assert.equal(reused.packages[0].reused, true);
});

test('npm failures retain partial receipts, remove temporary credentials and redact process diagnostics', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'doctopus-npm-publish-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const receiptPath = join(root, 'receipt.json');
  let privateRoot;
  await assert.rejects(
    publishNpmArchives(
      { directory: root, tag: 'latest', packages: [pkg] },
      {
        receiptPath,
        env: { NPM_TOKEN: 'unit-test-only' },
        request: async () => response({}, 404),
        run: async (_file, _args, options) => {
          privateRoot = options.cwd;
          throw Error('private process diagnostic containing unit-test-only');
        },
      },
    ),
    (error) =>
      /npm publication failed/.test(error.message) &&
      !error.message.includes('private process diagnostic'),
  );
  await assert.rejects(access(privateRoot));
  assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).complete, false);
});

test('registry HTTP requests constrain origins, redirects and streamed sizes without disclosing auth failures', async () => {
  for (const url of [
    'https://attacker.example/file',
    'http://registry.npmjs.org/file',
    'https://user:secret@registry.npmjs.org/file',
  ])
    await assert.rejects(releaseRequest(url));
  let called = false;
  const accepted = await releaseRequest('https://registry.npmjs.org/file', {
    fetchImpl: async (_url, options) => {
      called = true;
      assert.equal(options.redirect, 'error');
      assert(options.signal);
      return new Response('accepted');
    },
  });
  assert(called);
  assert.equal(accepted.bytes.toString(), 'accepted');
  for (const make of [
    () => new Response('oversized'),
    () => new Response('a', { headers: { 'content-length': '999999' } }),
    () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://attacker.example' },
      }),
  ])
    await assert.rejects(
      releaseRequest('https://registry.npmjs.org/file', {
        maximum: 2,
        fetchImpl: async () => make(),
      }),
    );
  await assert.rejects(
    releaseRequest(
      'https://central.sonatype.com/api/v1/publisher/status?id=public-id',
      {
        fetchImpl: async () => {
          throw Error('Bearer unit-test-secret');
        },
      },
    ),
    (error) => !error.message.includes('unit-test-secret'),
  );
});
