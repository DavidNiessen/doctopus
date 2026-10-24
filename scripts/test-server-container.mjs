import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import { assertOwnedCompose } from './lib/compose-fixtures.mjs';
import { verifyServerRecovery } from './lib/server-recovery-fixture.mjs';
import { verifyServerProxy } from './lib/server-proxy-fixture.mjs';
import { verifyOfflineInstall } from './lib/server-offline-fixture.mjs';
import { verifyServerUpgrade } from './lib/server-upgrade-fixture.mjs';

assert.equal(process.platform, 'linux', 'Use a local Linux Docker daemon.');
const requestedImage = process.env.SERVER_TEST_IMAGE;
const baselineImage = process.env.SERVER_BASELINE_IMAGE;
assert.match(
  baselineImage ?? '',
  /^sha256:[a-f0-9]{64}$/,
  'Build the historical server with scripts/build-upgrade-baseline.mjs and set SERVER_BASELINE_IMAGE to its immutable ID.',
);
assert.match(
  requestedImage ?? '',
  /^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64})$/,
  'Set SERVER_TEST_IMAGE to the approved immutable server image.',
);
const project = `doctopus-runtime-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const root = await mkdtemp(join(tmpdir(), 'doctopus-runtime-'));
const source = join(root, 'source'),
  store = join(root, 'artifacts'),
  secrets = join(root, 'secrets');
const override = join(root, 'compose.override.json');
const environment = {
  ...process.env,
  PUBLIC_URL: 'http://127.0.0.1:8080',
  INSECURE_DEVELOPMENT: 'true',
  DOCS_PORT: '0',
  DOCS_SECRETS_DIR: secrets,
};
for (const name of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete environment[name];
let phase = 'preflight',
  composeOwned = false,
  builder;
const secretValues = [];
const sanitize = (text) =>
  secretValues.reduce(
    (value, secret) => value.replaceAll(secret, '[fixture credential]'),
    text,
  );
function step(value) {
  phase = value;
  console.error(`Server container acceptance: ${value}`);
}
function docker(
  args,
  input,
  { includeStderr = false, environment: commandEnvironment = environment } = {},
) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      ['--host=unix:///var/run/docker.sock', ...args],
      { env: commandEnvironment, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `Docker failed during ${phase}: ${sanitize(stderr || error.message)}`,
            ),
          );
        else resolve((includeStderr ? stdout + '\n' + stderr : stdout).trim());
      },
    );
    child.stdin.end(input);
  });
}
const compose = (...args) =>
  docker([
    'compose',
    '--project-name',
    project,
    '-f',
    resolve('deploy/compose.yaml'),
    '-f',
    override,
    ...args,
  ]);
async function publicFixture(path) {
  await chmod(path, 0o755);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    assert(
      !entry.isSymbolicLink(),
      'Fixture artifacts must not contain links.',
    );
    if (entry.isDirectory()) await publicFixture(file);
    else {
      assert(entry.isFile());
      await chmod(file, 0o644);
    }
  }
}
async function waitFor(check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await setTimeout(500);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
// Executed inside the selected image; keep its imports local to the function.
async function readContainerRuntime() {
  const { readFileSync, existsSync } = await import('node:fs');
  const { toolVersion } = await import('@davidniessen/doctopus-contracts');
  const lines = readFileSync('/proc/self/status', 'utf8').split(
    String.fromCharCode(10),
  );
  const status = (name) =>
    lines
      .find((line) => line.startsWith(name + ':'))
      ?.split(':')[1]
      ?.trim();
  const group = (name) => readFileSync('/sys/fs/cgroup/' + name, 'utf8').trim();
  const capabilities = status('CapEff');
  return {
    toolVersion,
    packageManagersAbsent: [
      '/usr/local/bin/npm',
      '/usr/local/bin/npx',
      '/usr/local/bin/corepack',
      '/usr/local/bin/yarn',
      '/usr/local/bin/yarnpkg',
    ].every((path) => !existsSync(path)),
    uid: process.getuid(),
    memoryMax: group('memory.max'),
    cpuMax: group('cpu.max'),
    pidsMax: group('pids.max'),
    noNewPrivileges: status('NoNewPrivs') === '1',
    seccomp: status('Seccomp') === '2',
    capabilities:
      !!capabilities && [...capabilities].every((char) => char === '0'),
    readOnlyRoot: readFileSync('/proc/mounts', 'utf8')
      .split(String.fromCharCode(10))
      .some((line) => {
        const fields = line.split(' ');
        return fields[1] === '/' && fields[3].split(',').includes('ro');
      }),
  };
}
let report, failure;
try {
  const image = await docker([
    'image',
    'inspect',
    requestedImage,
    '--format',
    '{{.Id}}',
  ]);
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    JSON.parse(
      await docker([
        'image',
        'inspect',
        image,
        '--format',
        '{{json .Config.Cmd}}',
      ]),
    ),
    ['node', 'apps/server/dist/main.js'],
    'Select the server target, not the isolated-builder target.',
  );
  await new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      ['scripts/init-deployment.mjs', secrets],
      { env: environment, timeout: 10000 },
      (error) => (error ? reject(error) : resolve()),
    ),
  );
  const rootToken = (
    await readFile(join(secrets, 'root_token'), 'utf8')
  ).trim();
  secretValues.push(rootToken);
  for (const name of ['db_password', 'owner_password', 'runtime_password'])
    secretValues.push((await readFile(join(secrets, name), 'utf8')).trim());
  await chmod(root, 0o755);
  await mkdir(join(source, 'guides'), { recursive: true });
  const privateMarker = `private-container-fixture-${randomUUID()}`;
  const slug = project;
  await writeFile(
    join(source, 'docs.config.yaml'),
    `name: Container acceptance\nbasePath: /docs/${slug}\nspecs:\n  - id: fixture\n    path: openapi.json\n`,
  );
  await writeFile(
    join(source, 'guides/start.md'),
    `---\ntitle: Private container guide\n---\n\n${privateMarker}\n`,
  );
  await writeFile(
    join(source, 'openapi.json'),
    JSON.stringify({
      openapi: '3.1.0',
      info: {
        title: 'Container fixture',
        version: 'v1',
        description: privateMarker,
      },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            responses: {
              200: {
                description: 'Items',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );
  step('offline fixture compilation');
  builder = await docker([
    'create',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory',
    '512m',
    '--cpus',
    '2',
    '--pids-limit',
    '128',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=64m',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '--mount',
    `type=bind,src=${source},dst=/source`,
    image,
    'node',
    'packages/cli/dist/main.js',
    'build',
    '/source',
  ]);
  await docker(['start', '--attach', builder]);
  assert.equal(
    await docker(['inspect', '--format', '{{.State.ExitCode}}', builder]),
    '0',
  );
  await docker(['rm', '--volumes', builder]);
  builder = undefined;
  const directory = join(source, '.doctopus/site');
  const manifest = await verifyArtifact(directory);
  assert.equal(manifest.compilerVersion, toolVersion);
  const artifactId = manifest.artifactDigest;
  await mkdir(store);
  await cp(directory, join(store, artifactId), { recursive: true });
  await publicFixture(store);
  const limits = { mem_limit: '512m', cpus: 2, pids_limit: 128 };
  await writeFile(
    override,
    JSON.stringify({
      services: {
        docs: {
          image,
          pull_policy: 'never',
          ...limits,
          environment: {
            DATABASE_STATEMENT_TIMEOUT_MS: '500',
            DATABASE_QUERY_TIMEOUT_MS: '1000',
          },
          volumes: [
            {
              type: 'bind',
              source: store,
              target: '/data/artifacts',
              read_only: true,
            },
          ],
        },
        migrate: { image, pull_policy: 'never', ...limits },
        db: { mem_limit: '512m', cpus: 1, pids_limit: 128 },
      },
    }),
  );
  step('owned Compose configuration');
  const configuration = JSON.parse(await compose('config', '--format', 'json'));
  assertOwnedCompose(configuration, project, image);
  await docker([
    'image',
    'inspect',
    configuration.services.db.image,
    '--format',
    '{{.Id}}',
  ]);
  composeOwned = true;
  step('Compose installation');
  await compose(
    'up',
    '--detach',
    '--no-build',
    '--pull',
    'never',
    '--wait',
    '--wait-timeout',
    '90',
  );
  const server = await compose('ps', '--quiet', 'docs');
  assert.match(server, /^[a-f0-9]{64}$/);
  assert.equal(
    await docker(['inspect', '--format', '{{.Image}}', server]),
    image,
  );
  const host = JSON.parse(
    await docker(['inspect', '--format', '{{json .HostConfig}}', server]),
  );
  assert.equal(host.ReadonlyRootfs, true);
  assert.equal(host.Memory, 512 * 1024 * 1024);
  assert.equal(host.NanoCpus, 2_000_000_000);
  assert.equal(host.PidsLimit, 128);
  const probe = JSON.parse(
    await docker([
      'exec',
      server,
      'node',
      '--input-type=module',
      '-e',
      `console.log(JSON.stringify(await (${readContainerRuntime.toString()})()));`,
    ]),
  );
  assert.deepEqual(probe, {
    toolVersion,
    packageManagersAbsent: true,
    uid: 1000,
    memoryMax: '536870912',
    cpuMax: '200000 100000',
    pidsMax: '128',
    noNewPrivileges: true,
    seccomp: true,
    capabilities: true,
    readOnlyRoot: true,
  });
  const address = await compose('port', 'docs', '8080');
  assert.match(address, /^127\.0\.0\.1:[1-9]\d*$/);
  let base = `http://${address}`;
  const request = (path, token, method = 'GET', body) =>
    fetch(base + path, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function json(path, method, body, status) {
    const response = await request(path, rootToken, method, body);
    assert.equal(response.status, status, `${method} ${path}`);
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
  step('runtime database grants');
  assert.equal(
    await docker(
      [
        'compose',
        '--project-name',
        project,
        '-f',
        resolve('deploy/compose.yaml'),
        '-f',
        override,
        'exec',
        '-T',
        'db',
        'psql',
        '--username',
        'postgres',
        '--dbname',
        'doctopus',
        '--tuples-only',
        '--no-align',
        '--set',
        'ON_ERROR_STOP=1',
      ],
      "SELECT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole, has_schema_privilege('doctopus_runtime','public','CREATE'), has_table_privilege('doctopus_runtime','docs_audit','UPDATE'), has_table_privilege('doctopus_runtime','docs_audit','DELETE') FROM pg_roles WHERE rolname='doctopus_runtime';",
    ),
    't|f|f|f',
  );
  step('private publication');
  const created = await json(
    '/api/projects',
    'POST',
    { slug, name: 'Container acceptance', visibility: 'private' },
    201,
  );
  await json(
    `/api/projects/${created.id}/artifacts`,
    'POST',
    { artifactId },
    200,
  );
  const payload = {
    artifactId,
    expectedPublicationId: null,
    idempotencyKey: randomUUID(),
  };
  const publication = await json(
    `/api/projects/${created.id}/publications`,
    'POST',
    payload,
    201,
  );
  const expected = await readFile(join(directory, 'index.html'), 'utf8');
  assert(expected.includes(privateMarker));
  const privateRoot = `/docs/${slug}/`;
  const paths = [
    '',
    'page-data.json',
    'site.json',
    'search.json',
    'search-manifest.json',
    ...Object.keys(manifest.files)
      .filter((file) => file.startsWith('search/') && file.endsWith('.json'))
      .slice(0, 2),
    ...['.js', '.css'].map((extension) => {
      const path = Object.keys(manifest.files).find(
        (file) => file.startsWith('assets/') && file.endsWith(extension),
      );
      assert(path, `Missing fixture ${extension} asset.`);
      return path;
    }),
  ];
  assert(
    paths.length >= 8,
    'Fixture must exercise a search shard and catalog.',
  );
  for (const path of paths) {
    const allowed = await request(privateRoot + path, rootToken);
    assert.equal(allowed.status, 200, path);
    assert(allowed.headers.get('cache-control')?.includes('no-store'));
    if (!path) assert.equal(await allowed.text(), expected);
    else await allowed.arrayBuffer();
    const denied = await request(privateRoot + path);
    assert.equal(denied.status, 401, `Anonymous ${path}`);
    assert(!(await denied.text()).includes(privateMarker));
  }
  step('token revocation');
  const viewer = await json(
    `/api/projects/${created.id}/tokens`,
    'POST',
    { label: 'Container reader', role: 'viewer', expiresInDays: 1 },
    201,
  );
  assert.equal(typeof viewer.token, 'string');
  secretValues.push(viewer.token);
  const authorized = await request(privateRoot, viewer.token);
  assert.equal(authorized.status, 200);
  assert.equal(await authorized.text(), expected);
  await json(
    `/api/projects/${created.id}/tokens/${viewer.id}`,
    'DELETE',
    undefined,
    200,
  );
  const revoked = await request(privateRoot, viewer.token);
  assert.equal(revoked.status, 401);
  await revoked.arrayBuffer();
  step('server restart persistence');
  await compose('restart', 'docs');
  const restartedAddress = await compose('port', 'docs', '8080');
  assert.match(restartedAddress, /^127\.0\.0\.1:[1-9]\d*$/);
  base = `http://${restartedAddress}`;
  await waitFor(async () => {
    try {
      const response = await request('/health/ready');
      await response.arrayBuffer();
      return response.status === 200;
    } catch {
      return false;
    }
  }, 'restarted server');
  const persisted = await request(privateRoot, rootToken);
  assert.equal(persisted.status, 200);
  assert.equal(await persisted.text(), expected);
  assert.equal(
    (
      await json(
        `/api/projects/${created.id}/publications`,
        'POST',
        payload,
        201,
      )
    ).id,
    publication.id,
  );
  step('database outage');
  await compose('stop', '--timeout', '5', 'db');
  const unavailable = await request('/health/ready');
  assert.equal(unavailable.status, 503);
  await unavailable.arrayBuffer();
  const privateUnavailable = await request(privateRoot, rootToken);
  assert.equal(privateUnavailable.status, 503);
  assert(!(await privateUnavailable.text()).includes(privateMarker));
  const live = await request('/health/live');
  assert.equal(live.status, 200);
  await live.arrayBuffer();
  step('database recovery');
  await compose('start', 'db');
  await waitFor(async () => {
    try {
      const response = await request('/health/ready');
      await response.arrayBuffer();
      return response.status === 200;
    } catch {
      return false;
    }
  }, 'database recovery');
  const restored = await request(privateRoot, rootToken);
  assert.equal(restored.status, 200);
  assert.equal(await restored.text(), expected);
  const { directBase, ...proxy } = await verifyServerProxy({
    project,
    image,
    environment,
    root,
    docker,
    compose,
    step,
    waitFor,
    sanitize,
    rootToken,
    secretValues,
    privateRoot,
    privateMarker,
    expected,
    paths,
    artifactId,
  });
  base = directBase;
  const recovery = await verifyServerRecovery({
    environment,
    project,
    image,
    compose,
    step,
    sanitize,
    secretValues,
    projectId: created.id,
    rootToken,
    request,
    json,
    base,
    privateRoot,
    privateMarker,
    expected,
    paths,
    revokedToken: viewer.token,
    artifactId,
    publicationPayload: payload,
    publicationId: publication.id,
  });
  const offline = await verifyOfflineInstall({
    toolVersion,
    project,
    image,
    databaseReference: configuration.services.db.image,
    environment,
    docker,
    step,
    sanitize,
    secretValues,
    store,
    slug,
    expected,
    privateRoot,
    privateMarker,
    paths,
    artifactId,
  });
  report = {
    upgrade: await verifyServerUpgrade({
      project,
      image,
      baselineImage,
      environment,
      docker,
      step,
      sanitize,
      secretValues,
      store,
      slug,
      expected,
      privateRoot,
      privateMarker,
      paths,
      artifactId,
    }),
    offline,
    proxy,
    recovery,
    toolVersion,
    requestedImage,
    resolvedImage: image,
    artifactId,
    runtime: probe,
    privateFiles: paths.length,
    checks: [
      'offline-image-fixture-build',
      'shipped-compose-installation',
      'runtime-role-grants',
      'non-root-read-only-resource-limits',
      'private-files-after-authorized-cache-warm',
      'token-revocation',
      'restart-publication-persistence-and-idempotence',
      'database-outage-fails-closed',
      'database-recovery',
    ],
  };
} catch (error) {
  failure = error;
  if (composeOwned) {
    try {
      console.error(
        sanitize(
          await compose(
            'logs',
            '--no-color',
            '--tail',
            '20',
            'db',
            'migrate',
            'docs',
          ),
        ),
      );
    } catch {
      console.error('Container logs were unavailable.');
    }
  }
} finally {
  step('owned fixture cleanup');
  const failures = [];
  if (composeOwned) {
    try {
      await compose('down', '--volumes', '--remove-orphans', '--timeout', '5');
      assert.equal(
        await docker([
          'ps',
          '--all',
          '--quiet',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ]),
        '',
      );
      assert.equal(
        await docker([
          'volume',
          'ls',
          '--quiet',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ]),
        '',
      );
      assert.equal(
        await docker([
          'network',
          'ls',
          '--quiet',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ]),
        '',
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (builder) {
    try {
      await docker(['rm', '--force', '--volumes', builder]);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...failures],
      'Container acceptance or cleanup failed.',
    );
}
if (failure) throw failure;
assert(report);
console.log(JSON.stringify({ ...report, cleanupVerified: true }, null, 2));
