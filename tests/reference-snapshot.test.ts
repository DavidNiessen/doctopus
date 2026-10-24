import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileProject } from '@davidniessen/doctopus-compiler';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
  mkdir,
  symlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  downloadReferenceSnapshot,
  loadReferenceSnapshot,
  loadSpec,
  parseReferencePolicy,
  parseReferenceManifest,
  parseSource,
} from '@davidniessen/doctopus-spec';
import type {
  ReferencePolicy,
  ReferenceSnapshotOptions,
} from '@davidniessen/doctopus-spec';
import { vendorRemoteSpec, buildSite } from '@davidniessen/doctopus-cli';
let server: Server,
  origin = '',
  root = '',
  mode = 'normal',
  requests: string[] = [];
const exec = promisify(execFile);
const documents = new Map<string, Buffer>();
const authorization: { path: string; value: string | undefined }[] = [];
const hash = (source: string | Buffer) =>
  createHash('sha256').update(source).digest('hex');
const models = Buffer.from(
  'Widget:\n  type: object\n  properties:\n    id: {type: string}\n    parent: {$ref: "#/Widget"}\n',
);
let source: Buffer;
const policy = (): ReferencePolicy => ({
  schemaVersion: 1,
  root: origin + '/openapi.yaml',
  sources: [
    { url: origin + '/openapi.yaml', sha256: hash(source) },
    { url: origin + '/models.yaml', sha256: hash(models) },
  ],
});
const options = (): ReferenceSnapshotOptions => ({
  allowedOrigins: [origin],
  allowHttp: true,
  allowPrivateNetwork: true,
});
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'doctopus-pinned-spec-'));
  vi.stubEnv(
    'NO_PROXY',
    [process.env.NO_PROXY ?? '', '127.0.0.1'].filter(Boolean).join(','),
  );
  vi.stubEnv('no_proxy', process.env.NO_PROXY!);
  server = createServer((request, response) => {
    requests.push(request.url ?? '');
    authorization.push({
      path: request.url ?? '',
      value: request.headers.authorization,
    });
    if (mode === 'redirect') {
      response.writeHead(302, { location: '/models.yaml' }).end();
      return;
    }
    if (mode === 'hang') return;
    response.writeHead(200, { 'content-type': 'application/yaml' });
    response.end(
      documents.get(request.url ?? '') ??
        (request.url === '/openapi.yaml' ? source : models),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing fixture port');
  origin = 'http://127.0.0.1:' + address.port;
  source = Buffer.from(
    'openapi: 3.1.0\ninfo: {title: Pinned fixture, version: v1}\npaths:\n  /widgets:\n    get:\n      operationId: listWidgets\n      responses:\n        "200":\n          description: Widgets\n          content:\n            application/json:\n              schema: {$ref: "./models.yaml#/Widget"}\ncomponents:\n  schemas:\n    Widget: {$ref: "./models.yaml#/Widget"}\n',
  );
});
beforeEach(() => {
  mode = 'normal';
  requests = [];
  documents.clear();
  authorization.length = 0;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it('downloads pinned exact bytes and resolves transitive portable schemas through an offline cache', async () => {
  const snapshot = await downloadReferenceSnapshot(policy(), options());
  expect(snapshot.sources[0]?.source).toEqual(source);
  const result = await vendorRemoteSpec(root, policy(), options());
  expect(result.sources).toBe(2);
  expect(await readFile(join(root, result.path))).toEqual(source);
  const api = await loadSpec(root, {
    id: 'api',
    path: result.path,
    references: result.references,
  });
  expect(api.title).toBe('Pinned fixture');
  expect(api.operations[0]?.responses).toHaveLength(1);
  expect(JSON.stringify(api.schemas)).not.toContain(origin);
  const cached = await loadReferenceSnapshot(root, result.references);
  expect(cached.manifest.digest).toBe(result.digest);
  const count = requests.length;
  mode = 'hang';
  await loadSpec(root, {
    id: 'api',
    path: result.path,
    references: result.references,
  });
  expect(requests).toHaveLength(count);
});
it('is deterministic when policy source order changes and reuses completed snapshots without rewriting', async () => {
  const reversed = { ...policy(), sources: [...policy().sources].reverse() };
  const first = await vendorRemoteSpec(root, policy(), options()),
    second = await vendorRemoteSpec(root, reversed, options());
  expect(second).toEqual(first);
});
it.each([
  { schemaVersion: 2 },
  { root: 'https://user:secret@example.test/spec.yaml' },
  { sources: [] },
  { sources: [{ url: 'https://example.test/spec', sha256: 'bad' }] },
])('rejects invalid policy %#', (extra) => {
  expect(() => parseReferencePolicy({ ...policy(), ...extra })).toThrow();
});
it('refuses all sources before network access if one origin is unapproved', async () => {
  await expect(
    downloadReferenceSnapshot(
      {
        ...policy(),
        sources: [
          ...policy().sources,
          {
            url: 'https://unapproved.example.test/model.yaml',
            sha256: hash('x'),
          },
        ],
      },
      options(),
    ),
  ).rejects.toThrow(/origin/);
  expect(requests).toEqual([]);
});
it('fails a pin mismatch before validation or publication', async () => {
  await expect(
    vendorRemoteSpec(
      root,
      {
        ...policy(),
        sources: policy().sources.map((item) => ({
          ...item,
          sha256: '0'.repeat(64),
        })),
      },
      options(),
    ),
  ).rejects.toThrow(/SHA-256/);
});
it('does not fetch an undeclared resource referenced by approved source bytes', async () => {
  const before = source;
  try {
    source = Buffer.from(
      source.toString().replaceAll('./models.yaml', './not-approved.yaml'),
    );
    await expect(
      downloadReferenceSnapshot(policy(), options()),
    ).rejects.toThrow(/validation/);
    expect(requests).not.toContain('/not-approved.yaml');
  } finally {
    source = before;
  }
});
it.each(['file:///etc/passwd', '#named-anchor'])(
  'rejects unsupported references %s without resolver fallback',
  async (reference) => {
    const before = source;
    try {
      source = Buffer.from(
        source.toString().replaceAll('./models.yaml#/Widget', reference),
      );
      await expect(
        downloadReferenceSnapshot(policy(), options()),
      ).rejects.toThrow(/validation/);
    } finally {
      source = before;
    }
  },
);
it('rejects URI rebasing and dynamic keywords instead of silently changing their meaning', async () => {
  const before = source;
  try {
    source = Buffer.concat([
      source,
      Buffer.from('\nx-schema: {$id: "https://private.example.test/schema"}\n'),
    ]);
    await expect(
      downloadReferenceSnapshot(policy(), options()),
    ).rejects.toThrow(/validation/);
  } finally {
    source = before;
  }
});
it('rejects redirects, private destinations without opt-in and shared byte/deadline excesses', async () => {
  await expect(
    downloadReferenceSnapshot(policy(), {
      ...options(),
      allowPrivateNetwork: false,
    }),
  ).rejects.toThrow();
  await expect(
    downloadReferenceSnapshot(policy(), {
      ...options(),
      maxBytes: source.length,
    }),
  ).rejects.toThrow(/budget/);
  mode = 'redirect';
  await expect(
    downloadReferenceSnapshot(policy(), options()),
  ).rejects.toThrow();
  mode = 'hang';
  await expect(
    downloadReferenceSnapshot(policy(), { ...options(), timeoutMs: 30 }),
  ).rejects.toThrow();
  server.closeAllConnections();
});
it('preserves conflicting local cache bytes and refuses mismatched manifest metadata', async () => {
  const result = await vendorRemoteSpec(root, policy(), {
    ...options(),
    output: 'tampered',
  });
  const file = join(root, result.path),
    original = await readFile(file);
  await writeFile(file, 'local-edit');
  await expect(
    vendorRemoteSpec(root, policy(), { ...options(), output: 'tampered' }),
  ).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe('local-edit');
  await expect(
    loadSpec(root, {
      id: 'api',
      path: result.path,
      references: result.references,
    }),
  ).rejects.toThrow(/integrity/);
  await writeFile(file, original);
  const manifest = JSON.parse(
    await readFile(join(root, result.references), 'utf8'),
  );
  manifest.documents[0].sha256 = '0'.repeat(64);
  expect(() => parseReferenceManifest(manifest)).toThrow(/integrity/);
});
it('resumes matching partial snapshots using a final manifest commit marker', async () => {
  const snapshot = await downloadReferenceSnapshot(policy(), options()),
    directory = join(root, 'partial', snapshot.manifest.digest);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'source-0.yaml'),
    snapshot.sources[0]!.source,
  );
  const result = await vendorRemoteSpec(root, policy(), {
    ...options(),
    output: 'partial',
  });
  expect(
    (await loadReferenceSnapshot(root, result.references)).manifest.digest,
  ).toBe(snapshot.manifest.digest);
  expect(await readdir(join(root, 'partial'))).toEqual([
    snapshot.manifest.digest,
  ]);
});
it('rejects unsafe output and cache symlinks without overwriting local files', async () => {
  for (const output of ['../outside', '.git', 'folder//bad', '/absolute'])
    await expect(
      vendorRemoteSpec(root, policy(), { ...options(), output }),
    ).rejects.toThrow();
  const outside = await mkdtemp(join(tmpdir(), 'doctopus-vendor-outside-'));
  try {
    await symlink(outside, join(root, 'unsafe'));
    await expect(
      vendorRemoteSpec(root, policy(), { ...options(), output: 'unsafe' }),
    ).rejects.toThrow();
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
  const result = await vendorRemoteSpec(root, policy(), {
    ...options(),
    output: 'symlink',
  });
  const reference = join(root, result.references).replace(
    'snapshot.json',
    'source-1.yaml',
  );
  await rm(reference);
  await symlink(resolve(root, result.path), reference);
  await expect(loadReferenceSnapshot(root, result.references)).rejects.toThrow(
    /regular/,
  );
});
it('builds an ordinary project against pinned sources without additional network calls', async () => {
  const result = await vendorRemoteSpec(root, policy(), {
    ...options(),
    output: 'build-input',
  });
  await writeFile(
    join(root, 'docs.config.yaml'),
    JSON.stringify({
      name: 'Vendored',
      specs: [{ id: 'api', path: result.path, references: result.references }],
    }),
  );
  const before = requests.length;
  mode = 'hang';
  const built = await buildSite(root);
  expect(built.site.apis[0]?.title).toBe('Pinned fixture');
  expect(requests).toHaveLength(before);
});

it('binds bearer credentials to exact documents across different approved origins', async () => {
  const received: (string | undefined)[] = [];
  const other = createServer((request, response) => {
    received.push(request.headers.authorization);
    response.end(models);
  });
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  const address = other.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing second port');
  const modelUrl = 'http://127.0.0.1:' + address.port + '/models.yaml',
    before = source;
  try {
    source = Buffer.from(
      source.toString().replaceAll('./models.yaml', modelUrl),
    );
    const input: ReferencePolicy = {
      schemaVersion: 1,
      root: policy().root,
      sources: [policy().sources[0]!, { url: modelUrl, sha256: hash(models) }],
    };
    const config = {
      ...options(),
      allowedOrigins: [origin, new URL(modelUrl).origin],
      credentials: { [input.root]: 'root-private-token' },
    };
    const first = await downloadReferenceSnapshot(input, config);
    expect(authorization[0]?.value).toBe('Bearer root-private-token');
    expect(received).toEqual([undefined]);
    const second = await downloadReferenceSnapshot(input, {
      ...config,
      credentials: {
        [input.root]: 'root-private-token',
        [modelUrl]: 'reference-private-token',
      },
    });
    expect(received).toEqual([undefined, 'Bearer reference-private-token']);
    expect(JSON.stringify([first.manifest, second.manifest])).not.toMatch(
      /private-token|authorization|bearer/i,
    );
  } finally {
    source = before;
    other.closeAllConnections();
    await new Promise<void>((resolve) => other.close(() => resolve()));
  }
});
it('rejects unapproved credential bindings and hides external cancellation reasons', async () => {
  await expect(
    downloadReferenceSnapshot(policy(), {
      ...options(),
      credentials: { [origin + '/unlisted']: 'private' },
    }),
  ).rejects.toThrow(/binding/);
  expect(requests).toEqual([]);
  const controller = new AbortController();
  controller.abort(new Error('private-abort-reason'));
  await expect(
    downloadReferenceSnapshot(policy(), {
      ...options(),
      signal: controller.signal,
    }),
  ).rejects.not.toThrow(/private-abort-reason/);
});
it('resolves approved transitive documents using their own original URL bases', async () => {
  const model = Buffer.from(
      'Widget: {type: object, properties: {id: {$ref: "./common.yaml#/Id"}}}',
    ),
    common = Buffer.from('Id: {type: string}');
  documents.set('/models.yaml', model);
  documents.set('/common.yaml', common);
  const input = {
    ...policy(),
    sources: [
      policy().sources[0]!,
      { url: origin + '/models.yaml', sha256: hash(model) },
      { url: origin + '/common.yaml', sha256: hash(common) },
    ],
  };
  const result = await vendorRemoteSpec(root, input, {
    ...options(),
    output: 'transitive',
  });
  const api = await loadSpec(root, {
    id: 'api',
    path: result.path,
    references: result.references,
  });
  expect(JSON.stringify(api.schemas)).toContain('"type":"string"');
  expect(result.sources).toBe(3);
});
it('preserves original numeric tokens and supports OpenAPI 3.0 snapshots', async () => {
  const before = source;
  try {
    source = Buffer.from(
      source.toString().replace('3.1.0', '3.0.3') +
        '\nx-precise-example: 9007199254740993\n',
    );
    const result = await vendorRemoteSpec(root, policy(), {
      ...options(),
      output: 'legacy',
    });
    expect(await readFile(join(root, result.path))).toEqual(source);
    expect(
      (
        await loadSpec(root, {
          id: 'api',
          path: result.path,
          references: result.references,
        })
      ).openapiVersion,
    ).toBe('3.0.3');
  } finally {
    source = before;
  }
});
it('allows ordinary schema property names that resemble reference keywords', async () => {
  const before = source;
  try {
    const input = parseSource(source.toString(), 'fixture') as {
      components: { schemas: Record<string, unknown> };
    };
    input.components.schemas.Fields = {
      type: 'object',
      properties: { $id: { type: 'string' }, $ref: { type: 'string' } },
    };
    source = Buffer.from(JSON.stringify(input));
    expect(
      (await downloadReferenceSnapshot(policy(), options())).sources,
    ).toHaveLength(2);
  } finally {
    source = before;
  }
});
it('retains frozen source authority while applying an explicitly trusted source plugin', async () => {
  const result = await vendorRemoteSpec(root, policy(), {
    ...options(),
    output: 'plugin-input',
  });
  await writeFile(
    join(root, 'frozen-plugin.mjs'),
    `export default {name:'frozen-fixture',version:'1.0.0',pluginApi:'1',capabilities:['source'],loadSpec(source){if(!source.references)throw new Error('Missing snapshot context');return source.content.replace('Pinned fixture','Pinned plugin fixture');}};`,
  );
  await writeFile(
    join(root, 'docs.config.yaml'),
    JSON.stringify({
      name: 'Plugin snapshot',
      specs: [{ id: 'api', path: result.path, references: result.references }],
      plugins: ['frozen-plugin.mjs'],
    }),
  );
  const count = requests.length;
  mode = 'hang';
  expect(
    (await compileProject(root, undefined, { trustPlugins: true })).apis[0]
      ?.title,
  ).toBe('Pinned plugin fixture');
  expect(requests).toHaveLength(count);
});
it('runs the CLI with exact-source environment bindings and prints no URL or token', async () => {
  await writeFile(join(root, 'vendor-policy.json'), JSON.stringify(policy()));
  const result = await exec(
    process.execPath,
    [
      resolve('packages/cli/dist/main.js'),
      'vendor-spec',
      'vendor-policy.json',
      root,
      '--output',
      'cli-input',
      '--allow-origin',
      origin,
      '--allow-http',
      '--allow-private-network',
      '--bearer-env',
      policy().root + '=VENDOR_FIXTURE_TOKEN',
    ],
    { env: { ...process.env, VENDOR_FIXTURE_TOKEN: 'cli-private-token' } },
  );
  expect(result.stdout).toContain('Vendored 2 pinned sources');
  expect(result.stdout).not.toContain(origin);
  expect(result.stdout).not.toContain('cli-private-token');
  expect(authorization[0]?.value).toBe('Bearer cli-private-token');
  expect(authorization[1]?.value).toBeUndefined();
  const directories = await readdir(join(root, 'cli-input'));
  expect(directories).toHaveLength(1);
  expect(
    await readFile(
      join(root, 'cli-input', directories[0]!, 'snapshot.json'),
      'utf8',
    ),
  ).not.toContain('cli-private-token');
});
