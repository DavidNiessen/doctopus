import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  unlink,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertOwnedCompose } from './compose-fixtures.mjs';
import { sha256 } from './container-inventory.mjs';

/** Use generated credentials and destroy only these two owned fixture deployments. */
export async function verifyServerRecovery(source) {
  assert.match(
    source.project,
    /^doctopus-runtime-[a-f0-9]{16}$/,
    'Recovery must use an owned source fixture',
  );
  assert.match(source.image, /^sha256:[a-f0-9]{64}$/);
  const root = await mkdtemp(join(tmpdir(), 'doctopus-recovery-check-'));
  const project =
    'doctopus-restore-' + randomUUID().replaceAll('-', '').slice(0, 16);
  const secrets = join(root, 'secrets');
  const backup = join(root, 'backup');
  const imageOverride = join(root, 'compose.images.json');
  let databaseImage;
  const environment = {
    ...source.environment,
    COMPOSE_PROJECT_NAME: project,
    DOCS_IMAGE: source.image,
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
  let owned = false,
    report,
    failure;
  async function command(file, args, env = environment) {
    try {
      return await promisify(execFile)(file, args, {
        env,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
      });
    } catch (error) {
      for (const key of ['message', 'stack', 'stdout', 'stderr', 'cmd'])
        if (typeof error[key] === 'string')
          error[key] = source.sanitize(error[key]);
      throw error;
    }
  }
  const docker = (args) =>
    command('docker', ['--host=unix:///var/run/docker.sock', ...args]).then(
      (result) => result.stdout.trim(),
    );
  const compose = (...args) =>
    docker([
      'compose',
      '--project-name',
      project,
      '-f',
      resolve('deploy/compose.yaml'),
      '-f',
      imageOverride,
      ...args,
    ]);
  async function recovery(action, env, expectedError) {
    const args = ['scripts/recovery.mjs', action, backup, '--writers-paused'];
    if (action === 'restore') args.push('--compose-override', imageOverride);
    // The operator CLI honors Docker's endpoint environment; make this fixture local explicitly.
    const local = { ...env, DOCKER_HOST: 'unix:///var/run/docker.sock' };
    if (expectedError) {
      await assert.rejects(command(process.execPath, args, local), (error) =>
        error.message.includes(expectedError),
      );
    } else await command(process.execPath, args, local);
  }
  try {
    const originalConfiguration = JSON.parse(
      await source.compose('config', '--format', 'json'),
    );
    databaseImage = await docker([
      'image',
      'inspect',
      originalConfiguration.services.db.image,
      '--format',
      '{{.Id}}',
    ]);
    assert.match(databaseImage, /^sha256:[a-f0-9]{64}$/);
    const service = (image) => ({ image, pull_policy: 'never' });
    await writeFile(
      imageOverride,
      JSON.stringify({
        services: {
          db: service(databaseImage),
          migrate: service(source.image),
          docs: service(source.image),
        },
      }),
    );
    source.step('recovery source identities');
    const active = await source.json(
      `/api/projects/${source.projectId}/tokens`,
      'POST',
      { label: 'Restored viewer', role: 'viewer', expiresInDays: 1 },
      201,
    );
    assert.equal(typeof active.token, 'string');
    source.secretValues.push(active.token);
    const session = await source.request('/auth/token', active.token, 'POST');
    assert.equal(session.status, 200);
    await session.arrayBuffer();
    const cookie = session.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie ?? '', /^docs_session=.+/);
    source.secretValues.push(cookie, cookie.slice('docs_session='.length));
    const signedIn = await fetch(source.base + source.privateRoot, {
      headers: { cookie },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(signedIn.status, 200);
    assert.equal(await signedIn.text(), source.expected);
    const auditResponse = await source.request(
      `/api/projects/${source.projectId}/audit`,
      source.rootToken,
    );
    assert.equal(auditResponse.status, 200);
    const audit = await auditResponse.json();
    await source.compose(
      'exec',
      '-T',
      'db',
      'psql',
      '--username=postgres',
      '--dbname=doctopus',
      '--set',
      'ON_ERROR_STOP=1',
      '-c',
      "INSERT INTO docs_oidc(state_hash,nonce,verifier,expires_at) VALUES('recovery-fixture-state','fixture-nonce','fixture-verifier',clock_timestamp()+interval '1 hour')",
    );
    assert.equal(
      await source.compose(
        'exec',
        '-T',
        'db',
        'psql',
        '--username=postgres',
        '--dbname=doctopus',
        '-Atc',
        'SELECT (SELECT count(*)>0 FROM docs_sessions),(SELECT count(*)>0 FROM docs_oidc)',
      ),
      't|t',
    );

    source.step('recovery backup');
    await recovery('backup', {
      ...source.environment,
      COMPOSE_PROJECT_NAME: source.project,
      DOCS_IMAGE: source.image,
    });
    const metadata = JSON.parse(
      await readFile(join(backup, 'recovery.json'), 'utf8'),
    );
    assert.equal(metadata.schemaVersion, 1);
    assert.equal(metadata.sourceProject, source.project);
    assert.equal((await stat(backup)).mode & 0o077, 0);
    for (const name of ['database.dump', 'artifacts.tar'])
      assert.equal(await sha256(join(backup, name)), metadata.files[name]);

    // Free the source before a fresh target, keeping both real recovery and VFS disk usage bounded.
    await source.compose(
      'down',
      '--volumes',
      '--remove-orphans',
      '--timeout',
      '5',
    );
    source.step('recovery fresh target');
    await command(process.execPath, ['scripts/init-deployment.mjs', secrets]);
    const rootToken = (
      await readFile(join(secrets, 'root_token'), 'utf8')
    ).trim();
    for (const name of [
      'root_token',
      'db_password',
      'owner_password',
      'runtime_password',
    ])
      source.secretValues.push(
        (await readFile(join(secrets, name), 'utf8')).trim(),
      );
    assert.notEqual(rootToken, source.rootToken);
    const configuration = JSON.parse(
      await compose('config', '--format', 'json'),
    );
    assertOwnedCompose(configuration, project, source.image, { databaseImage });
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
    owned = true;
    await writeFile(join(backup, '.incomplete'), 'Not complete');
    try {
      await recovery(
        'restore',
        environment,
        'Refusing an incomplete recovery set',
      );
    } finally {
      await unlink(join(backup, '.incomplete'));
    }
    const dump = join(backup, 'database.dump');
    const bytes = await readFile(dump);
    await writeFile(dump, Buffer.concat([bytes, Buffer.from('corrupt')]));
    try {
      await recovery('restore', environment, 'Recovery integrity check failed');
    } finally {
      await writeFile(dump, bytes);
    }
    assert.equal(
      await docker([
        'ps',
        '--all',
        '--quiet',
        '--filter',
        `label=com.docker.compose.project=${project}`,
      ]),
      '',
      'Bad backups must fail before deployment changes',
    );
    await recovery('restore', environment);
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
    const id = await compose('ps', '--quiet', 'docs');
    assert.equal(
      await docker(['inspect', '--format', '{{.Image}}', id]),
      source.image,
    );
    const database = await compose('ps', '--quiet', 'db');
    assert.equal(
      await docker(['inspect', '--format', '{{.Image}}', database]),
      databaseImage,
    );
    const address = await compose('port', 'docs', '8080');
    assert.match(address, /^127\.0\.0\.1:[1-9]\d*$/);
    const base = 'http://' + address;
    const request = (path, token = rootToken, method = 'GET', body) =>
      fetch(base + path, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers: {
          ...(token ? { authorization: 'Bearer ' + token } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    source.step('recovery publication and identities');
    const restored = await request(source.privateRoot);
    assert.equal(restored.status, 200);
    assert.equal(await restored.text(), source.expected);
    for (const path of source.paths) {
      const denied = await request(source.privateRoot + path, null);
      assert.equal(denied.status, 401);
      assert(!(await denied.text()).includes(source.privateMarker));
    }
    for (const [token, status] of [
      [active.token, 200],
      [source.revokedToken, 401],
      [source.rootToken, 401],
    ]) {
      const response = await request(source.privateRoot, token);
      assert.equal(response.status, status);
      await response.arrayBuffer();
    }
    const oldSession = await fetch(base + source.privateRoot, {
      headers: { cookie },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(oldSession.status, 401);
    await oldSession.arrayBuffer();
    assert.equal(
      await compose(
        'exec',
        '-T',
        'db',
        'psql',
        '--username=postgres',
        '--dbname=doctopus',
        '-Atc',
        'SELECT (SELECT count(*) FROM docs_sessions),(SELECT count(*) FROM docs_oidc)',
      ),
      '0|0',
    );
    const restoredAudit = await request(
      `/api/projects/${source.projectId}/audit`,
    );
    assert.equal(restoredAudit.status, 200);
    assert.deepEqual(await restoredAudit.json(), audit);
    const repeated = await request(
      `/api/projects/${source.projectId}/publications`,
      rootToken,
      'POST',
      source.publicationPayload,
    );
    assert.equal(repeated.status, 201);
    assert.equal((await repeated.json()).id, source.publicationId);
    assert.equal(
      await compose(
        'exec',
        '-T',
        'db',
        'psql',
        '--username=postgres',
        '--dbname=doctopus',
        '-Atc',
        "SELECT has_schema_privilege('doctopus_runtime','public','CREATE'), has_table_privilege('doctopus_runtime','docs_audit','UPDATE'), has_table_privilege('doctopus_runtime','docs_audit','DELETE')",
      ),
      'f|f|f',
    );
    source.step('recovery overwrite refusal');
    await recovery('restore', environment, 'Restore requires a fresh database');
    const unchanged = await request(source.privateRoot);
    assert.equal(unchanged.status, 200);
    assert.equal(await unchanged.text(), source.expected);
    report = {
      sourceProject: source.project,
      targetProject: project,
      resolvedImage: source.image,
      databaseImage,
      composeOverride: true,
      artifactId: source.artifactId,
      checks: [
        'backup-checksums-and-private-directory',
        'incomplete-and-corrupt-backup-refusal-before-mutation',
        'fresh-project-restore',
        'same-publication-and-private-file-denial',
        'token-hashes-revocation-and-root-rotation',
        'sessions-and-pending-oidc-excluded',
        'audit-history-and-publication-idempotence',
        'runtime-grants-restored',
        'existing-database-overwrite-refusal',
      ],
    };
  } catch (error) {
    failure = error;
  } finally {
    source.step('recovery target cleanup');
    try {
      if (owned) {
        await compose(
          'down',
          '--volumes',
          '--remove-orphans',
          '--timeout',
          '5',
        );
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
      }
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      failure = new AggregateError(
        [...(failure ? [failure] : []), error],
        'Recovery acceptance or cleanup failed',
      );
    }
  }
  if (failure) throw failure;
  assert(report);
  return { ...report, cleanupVerified: true };
}
