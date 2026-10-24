import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertOwnedCompose } from './compose-fixtures.mjs';

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Run only inside the owned server container; credentials arrive through stdin.
async function probeOfflineInstallation() {
  const { default: assert } = await import('node:assert/strict');
  const { readFile } = await import('node:fs/promises');
  const { randomUUID } = await import('node:crypto');
  const { toolVersion } = await import('@davidniessen/doctopus-contracts');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const fixture = JSON.parse(input);
  assert.equal(process.getuid(), 1000);
  const routes = (await readFile('/proc/net/route', 'utf8'))
    .trim()
    .split('\n')
    .slice(1);
  assert(routes.length > 0);
  assert(
    routes.every((route) => route.trim().split(/\s+/)[1] !== '00000000'),
    'Offline application must have no default network route.',
  );
  const request = async (
    path,
    status,
    { authenticated = true, method = 'GET', body } = {},
  ) => {
    const response = await fetch('http://127.0.0.1:8080' + path, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(authenticated
          ? { authorization: 'Bearer ' + fixture.rootToken }
          : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, status, method + ' ' + path);
    return { text: await response.text(), headers: response.headers };
  };
  await request('/health/ready', 200, { authenticated: false });
  const created = JSON.parse(
    (
      await request('/api/projects', 201, {
        method: 'POST',
        body: {
          slug: fixture.slug,
          name: 'Offline installation',
          visibility: 'private',
        },
      })
    ).text,
  );
  await request(`/api/projects/${created.id}/artifacts`, 200, {
    method: 'POST',
    body: { artifactId: fixture.artifactId },
  });
  await request(`/api/projects/${created.id}/publications`, 201, {
    method: 'POST',
    body: {
      artifactId: fixture.artifactId,
      expectedPublicationId: null,
      idempotencyKey: randomUUID(),
    },
  });
  for (const path of fixture.paths) {
    const allowed = await request(fixture.privateRoot + path, 200);
    assert(allowed.headers.get('cache-control')?.includes('no-store'));
    if (!path) assert.equal(allowed.text, fixture.expected);
    const denied = await request(fixture.privateRoot + path, 401, {
      authenticated: false,
    });
    assert(!denied.text.includes(fixture.privateMarker));
  }
  console.log(
    JSON.stringify({
      toolVersion,
      uid: process.getuid(),
      defaultRoute: false,
      artifactId: fixture.artifactId,
      privateFiles: fixture.paths.length,
    }),
  );
}

/** Reimport untagged images and boot a fresh isolated deployment without registry pulls. */
export async function verifyOfflineInstall(source) {
  assert.match(source.project, /^doctopus-runtime-[a-f0-9]{16}$/);
  assert.match(source.image, /^sha256:[a-f0-9]{64}$/);
  assert.match(
    source.databaseReference,
    /^postgres:17-alpine@sha256:[a-f0-9]{64}$/,
  );
  const root = await mkdtemp(join(tmpdir(), 'doctopus-offline-'));
  const project =
    'doctopus-offline-' + randomUUID().replaceAll('-', '').slice(0, 16);
  const secrets = join(root, 'secrets');
  const archive = join(root, 'images.tar');
  const override = join(root, 'compose.offline.json');
  const environment = {
    ...source.environment,
    COMPOSE_PROJECT_NAME: project,
    DOCS_IMAGE: source.image,
    DOCS_SECRETS_DIR: secrets,
    DOCS_PORT: '0',
    PUBLIC_URL: 'https://offline.example.invalid',
    INSECURE_DEVELOPMENT: 'false',
  };
  const docker = (args, input) => source.docker(args, input, { environment });
  const command = async (file, args, commandEnvironment = environment) => {
    try {
      return await promisify(execFile)(file, args, {
        cwd: root,
        env: commandEnvironment,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      for (const key of ['message', 'stack', 'stdout', 'stderr', 'cmd'])
        if (typeof error[key] === 'string')
          error[key] = source.sanitize(error[key]);
      throw error;
    }
  };
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
  const assertAbsent = async () => {
    for (const args of [
      ['ps', '--all', '--quiet'],
      ['volume', 'ls', '--quiet'],
      ['network', 'ls', '--quiet'],
    ])
      assert.equal(
        await docker([
          ...args,
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ]),
        '',
      );
  };
  let owned = false,
    report,
    failure;
  try {
    source.step('offline immutable image export');
    const databaseImage = await docker([
      'image',
      'inspect',
      source.databaseReference,
      '--format',
      '{{.Id}}',
    ]);
    assert.match(databaseImage, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(databaseImage, source.image);
    const images = [source.image, databaseImage];
    const tags = async () =>
      Promise.all(
        images.map(
          async (image) =>
            JSON.parse(
              await docker([
                'image',
                'inspect',
                image,
                '--format',
                '{{json .RepoTags}}',
              ]),
            ) ?? [],
        ),
      );
    const originalTags = await tags();
    await docker(['image', 'save', '--output', archive, ...images]);
    let archiveBytes, archiveSha256;
    const archiveFile = await open(
      archive,
      constants.O_RDWR | constants.O_NOFOLLOW,
    );
    try {
      const metadata = await archiveFile.stat();
      assert(metadata.isFile() && metadata.size > 0);
      archiveBytes = metadata.size;
      const manifest = JSON.parse(
        (await command('tar', ['-xOf', archive, 'manifest.json'])).stdout,
      );
      assert.equal(manifest.length, 2);
      assert(
        manifest.every((entry) => !entry.RepoTags?.length),
        'Image archives must not replace mutable local tags.',
      );
      const configurations = [];
      for (const entry of manifest) {
        const match = /^(?:blobs\/sha256\/)?([a-f0-9]{64})(?:\.json)?$/.exec(
          entry.Config,
        );
        assert(match, 'Invalid archived image configuration path.');
        const bytes = await command('tar', ['-xOf', archive, entry.Config]);
        assert.equal(
          createHash('sha256').update(bytes.stdout).digest('hex'),
          match[1],
        );
        configurations.push('sha256:' + match[1]);
      }
      assert.deepEqual(configurations.sort(), [...images].sort());
      archiveSha256 = await hashFile(archive);
      const checksums = join(root, 'SHA256SUMS');
      await writeFile(checksums, archiveSha256 + '  images.tar\n');
      source.step('offline archive checksum refusal and import');
      try {
        await archiveFile.write(
          'Corrupt offline archive',
          archiveBytes,
          'utf8',
        );
        await assert.rejects(command('sha256sum', ['--check', checksums]));
      } finally {
        await archiveFile.truncate(archiveBytes);
      }
      await command('sha256sum', ['--check', checksums]);
      assert.equal(await hashFile(archive), archiveSha256);
    } finally {
      await archiveFile.close();
    }
    await docker(['image', 'load', '--input', archive]);
    for (const image of images)
      assert.equal(
        await docker(['image', 'inspect', image, '--format', '{{.Id}}']),
        image,
      );
    assert.deepEqual(await tags(), originalTags);
    // Import verification has finished; avoid retaining a second full image set during startup.
    await rm(archive);

    await command(process.execPath, [
      resolve('scripts/init-deployment.mjs'),
      secrets,
    ]);
    for (const name of [
      'root_token',
      'db_password',
      'owner_password',
      'runtime_password',
    ])
      source.secretValues.push(
        (await readFile(join(secrets, name), 'utf8')).trim(),
      );
    const rootToken = (
      await readFile(join(secrets, 'root_token'), 'utf8')
    ).trim();
    const limits = { mem_limit: '512m', cpus: 1, pids_limit: 128 };
    await writeFile(
      override,
      JSON.stringify({
        services: {
          db: { image: databaseImage, pull_policy: 'never', ...limits },
          migrate: { image: source.image, pull_policy: 'never', ...limits },
          docs: {
            image: source.image,
            pull_policy: 'never',
            ...limits,
            volumes: [
              {
                type: 'bind',
                source: source.store,
                target: '/data/artifacts',
                read_only: true,
              },
            ],
          },
        },
        networks: { frontend: { internal: true } },
      }),
    );
    const configuration = JSON.parse(
      await compose('config', '--format', 'json'),
    );
    assertOwnedCompose(configuration, project, source.image, { databaseImage });
    assert.equal(configuration.networks.frontend.internal, true);
    await assertAbsent();
    owned = true;
    source.step('offline fresh Compose installation');
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
      source.image,
    );
    const networks = Object.keys(
      JSON.parse(
        await docker([
          'inspect',
          '--format',
          '{{json .NetworkSettings.Networks}}',
          server,
        ]),
      ),
    );
    assert.deepEqual(networks.sort(), [
      project + '_backend',
      project + '_frontend',
    ]);
    for (const network of networks) {
      const inspected = JSON.parse(
        await docker(['network', 'inspect', network, '--format', '{{json .}}']),
      );
      assert.equal(inspected.Internal, true);
      assert.equal(inspected.EnableIPv6, false);
    }
    const runtime = JSON.parse(
      await docker(
        [
          'exec',
          '-i',
          server,
          'node',
          '--input-type=module',
          '-e',
          `await (${probeOfflineInstallation.toString()})();`,
        ],
        JSON.stringify({
          rootToken,
          slug: source.slug,
          artifactId: source.artifactId,
          paths: source.paths,
          privateRoot: source.privateRoot,
          expected: source.expected,
          privateMarker: source.privateMarker,
        }),
      ),
    );
    assert.equal(runtime.toolVersion, source.toolVersion);
    assert.equal(runtime.artifactId, source.artifactId);
    assert.equal(runtime.defaultRoute, false);
    assert(runtime.privateFiles >= 8);
    source.step('offline backup with the imported-image configuration');
    const backup = join(root, 'backup');
    await command(
      process.execPath,
      [
        resolve('scripts/recovery.mjs'),
        'backup',
        backup,
        '--writers-paused',
        '--compose-override',
        override,
      ],
      {
        ...environment,
        DOCKER_HOST: 'unix:///var/run/docker.sock',
      },
    );
    const recovery = JSON.parse(
      await readFile(join(backup, 'recovery.json'), 'utf8'),
    );
    assert.equal(recovery.sourceProject, project);
    for (const file of ['database.dump', 'artifacts.tar'])
      assert.equal(await hashFile(join(backup, file)), recovery.files[file]);
    report = {
      serverImage: source.image,
      databaseReference: source.databaseReference,
      databaseImage,
      artifactId: source.artifactId,
      archiveBytes,
      archiveSha256,
      backupWithComposeOverride: true,
      runtime,
      checks: [
        'immutable-untagged-image-export-and-config-hashes',
        'archive-checksum-verification-and-corruption-refusal',
        'image-archive-import-without-retagging',
        'fresh-shipped-compose-installation-with-pull-never',
        'two-internal-networks-without-an-application-default-route',
        'non-root-offline-runtime-and-version',
        'offline-private-publication-data-search-and-assets',
        'backup-with-the-imported-image-compose-override',
      ],
    };
  } catch (error) {
    failure = error;
  } finally {
    source.step('offline owned fixture cleanup');
    const failures = [];
    if (owned) {
      try {
        await compose(
          'down',
          '--volumes',
          '--remove-orphans',
          '--timeout',
          '5',
        );
        await assertAbsent();
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
        'Offline installation or owned cleanup failed.',
      );
  }
  if (failure) throw failure;
  assert(report);
  return { ...report, cleanupVerified: true };
}
