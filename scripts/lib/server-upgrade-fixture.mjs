import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertOwnedCompose } from './compose-fixtures.mjs';
import { sha256 } from './container-inventory.mjs';

export const upgradeBaselineCommit = 'ff2c87f874357792fb9ac575f8002e9e88d0f94e';

// Compare every durable pre-queue table, including token hashes, without exposing rows.
const metadataSnapshot = `SELECT json_build_object(
 'projects',(SELECT json_agg(t ORDER BY id) FROM docs_projects t),
 'roles',(SELECT json_agg(t ORDER BY project_id,subject) FROM docs_roles t),
 'artifacts',(SELECT json_agg(t ORDER BY project_id,artifact_id) FROM docs_artifacts t),
 'publications',(SELECT json_agg(t ORDER BY id) FROM docs_publications t),
 'tokens',(SELECT json_agg(t ORDER BY id) FROM docs_tokens t),
 'audit',(SELECT json_agg(t ORDER BY id) FROM docs_audit t)
)::text`;

/** Upgrade actual schema-1 containers, then recover their backup with the old image. */
export async function verifyServerUpgrade(source) {
  assert.match(source.project, /^doctopus-runtime-[a-f0-9]{16}$/);
  assert.match(source.image, /^sha256:[a-f0-9]{64}$/);
  assert.match(source.baselineImage ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(source.image, source.baselineImage);
  const root = await mkdtemp(join(tmpdir(), 'doctopus-upgrade-'));
  const backup = join(root, 'backup');
  const environment = { ...source.environment };
  const docker = (args, input) => source.docker(args, input, { environment });
  const command = async (args, env) => {
    try {
      return await promisify(execFile)(process.execPath, args, {
        env: { ...env, DOCKER_HOST: 'unix:///var/run/docker.sock' },
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
  const fixtures = [];
  const assertAbsent = async (project) => {
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
  async function prepare(kind, image, artifactBind) {
    const project = `doctopus-${kind}-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const secrets = join(root, kind + '-secrets');
    const override = join(root, kind + '.json');
    const env = {
      ...environment,
      COMPOSE_PROJECT_NAME: project,
      DOCS_SECRETS_DIR: secrets,
      DOCS_PORT: '0',
      DOCS_IMAGE: image,
      PUBLIC_URL: 'http://127.0.0.1:8080',
      INSECURE_DEVELOPMENT: 'true',
    };
    await command([resolve('scripts/init-deployment.mjs'), secrets], env);
    for (const name of [
      'root_token',
      'db_password',
      'owner_password',
      'runtime_password',
    ])
      source.secretValues.push(
        (await readFile(join(secrets, name), 'utf8')).trim(),
      );
    const token = (await readFile(join(secrets, 'root_token'), 'utf8')).trim();
    const fixture = { project, env, override, token, image, owned: false };
    fixture.select = async (selected) => {
      const limits = { mem_limit: '512m', cpus: 1, pids_limit: 128 };
      await writeFile(
        override,
        JSON.stringify({
          services: {
            db: limits,
            migrate: { image: selected, pull_policy: 'never', ...limits },
            docs: {
              image: selected,
              pull_policy: 'never',
              ...limits,
              restart: 'no',
              ...(artifactBind
                ? {
                    volumes: [
                      {
                        type: 'bind',
                        source: source.store,
                        target: '/data/artifacts',
                        read_only: true,
                      },
                    ],
                  }
                : {}),
            },
          },
        }),
      );
      const configuration = JSON.parse(
        await fixture.compose('config', '--format', 'json'),
      );
      assertOwnedCompose(configuration, project, selected);
      fixture.image = selected;
    };
    fixture.compose = (...args) =>
      source.docker(
        [
          'compose',
          '--project-name',
          project,
          '-f',
          resolve('deploy/compose.yaml'),
          '-f',
          override,
          ...args,
        ],
        undefined,
        { environment: env },
      );
    fixture.sql = (sql) =>
      fixture.compose(
        'exec',
        '-T',
        'db',
        'psql',
        '--username=postgres',
        '--dbname=doctopus',
        '-v',
        'ON_ERROR_STOP=1',
        '-Atc',
        sql,
      );
    fixture.up = () =>
      fixture.compose(
        'up',
        '--detach',
        '--no-build',
        '--pull',
        'never',
        '--wait',
        '--wait-timeout',
        '90',
      );
    fixture.backup = (action) =>
      command(
        [
          resolve('scripts/recovery.mjs'),
          action,
          backup,
          '--writers-paused',
          '--compose-override',
          override,
        ],
        env,
      );
    fixture.close = async () => {
      if (!fixture.owned) return;
      await fixture.compose(
        'down',
        '--volumes',
        '--remove-orphans',
        '--timeout',
        '5',
      );
      await assertAbsent(project);
      fixture.owned = false;
    };
    fixture.client = async () => {
      const id = await fixture.compose('ps', '--quiet', 'docs');
      assert.match(id, /^[a-f0-9]{64}$/);
      assert.equal(
        await docker(['inspect', '--format', '{{.Image}}', id]),
        fixture.image,
      );
      const address = await fixture.compose('port', 'docs', '8080');
      assert.match(address, /^127\.0\.0\.1:[1-9]\d*$/);
      return async (
        path,
        status,
        { token = fixture.token, method = 'GET', body } = {},
      ) => {
        const response = await fetch('http://' + address + path, {
          method,
          redirect: 'manual',
          signal: AbortSignal.timeout(10000),
          headers: {
            ...(token ? { authorization: 'Bearer ' + token } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.equal(response.status, status, method + ' ' + path);
        return response.text();
      };
    };
    fixtures.push(fixture);
    await fixture.select(image);
    await assertAbsent(project);
    fixture.owned = true;
    return fixture;
  }
  async function privateFiles(request, token) {
    for (const path of source.paths) {
      const allowed = await request(source.privateRoot + path, 200, { token });
      if (!path) assert.equal(allowed, source.expected);
      const denied = await request(source.privateRoot + path, 401, {
        token: '',
      });
      assert(!denied.includes(source.privateMarker));
    }
  }
  const metadataDigest = async (fixture) =>
    createHash('sha256')
      .update(await fixture.sql(metadataSnapshot))
      .digest('hex');
  let report, failure;
  try {
    const labels = JSON.parse(
      await docker([
        'image',
        'inspect',
        source.baselineImage,
        '--format',
        '{{json .Config.Labels}}',
      ]),
    );
    assert.equal(
      labels?.['org.opencontainers.image.revision'],
      upgradeBaselineCommit,
      'Build the baseline from the recorded historical source commit.',
    );
    source.step('upgrade historical schema-1 installation');
    const original = await prepare('upgrade', source.baselineImage, true);
    await original.up();
    assert.equal(
      await original.sql(
        "SELECT string_agg(version::text,',' ORDER BY version) FROM docs_schema_migrations",
      ),
      '1',
    );
    const request = await original.client();
    const project = JSON.parse(
      await request('/api/projects', 201, {
        method: 'POST',
        body: {
          slug: source.slug,
          name: 'Upgrade fixture',
          visibility: 'private',
        },
      }),
    );
    await request(`/api/projects/${project.id}/artifacts`, 200, {
      method: 'POST',
      body: { artifactId: source.artifactId },
    });
    const payload = {
      artifactId: source.artifactId,
      expectedPublicationId: null,
      idempotencyKey: randomUUID(),
    };
    const publication = JSON.parse(
      await request(`/api/projects/${project.id}/publications`, 201, {
        method: 'POST',
        body: payload,
      }),
    );
    const viewer = JSON.parse(
      await request(`/api/projects/${project.id}/tokens`, 201, {
        method: 'POST',
        body: { label: 'Upgrade viewer', role: 'viewer', expiresInDays: 1 },
      }),
    );
    source.secretValues.push(viewer.token);
    await request(`/api/projects/${project.id}/roles`, 200, {
      method: 'PUT',
      body: { subject: 'upgrade-editor', role: 'editor' },
    });
    await privateFiles(request, viewer.token);
    const before = await metadataDigest(original);
    source.step('upgrade pre-migration recovery set');
    await original.backup('backup');
    const metadata = JSON.parse(
      await readFile(join(backup, 'recovery.json'), 'utf8'),
    );
    for (const file of ['database.dump', 'artifacts.tar'])
      assert.equal(await sha256(join(backup, file)), metadata.files[file]);
    await original.compose('stop', 'docs');
    await original.compose('rm', '--force', 'docs', 'migrate');
    await original.select(source.image);
    await assert.rejects(
      original.compose('run', '--rm', '-T', '--no-deps', 'docs'),
      /Server startup failed/,
    );
    assert.equal(await metadataDigest(original), before);
    source.step('upgrade failed migration remains atomic');
    await original.sql(
      'SET ROLE doctopus_owner; CREATE TABLE docs_build_jobs(marker text)',
    );
    await assert.rejects(
      original.compose('run', '--rm', '-T', '--no-deps', 'migrate'),
      /Database migration failed/,
    );
    assert.equal(
      await original.sql(
        "SELECT (SELECT max(version) FROM docs_schema_migrations), to_regclass('docs_build_sources') IS NULL",
      ),
      '1|t',
    );
    assert.equal(await metadataDigest(original), before);
    await original.sql('SET ROLE doctopus_owner; DROP TABLE docs_build_jobs');
    source.step('upgrade matching migration and runtime');
    await original.compose('run', '--rm', '-T', '--no-deps', 'migrate');
    assert.equal(
      await original.sql(
        "SELECT string_agg(version::text,',' ORDER BY version) FROM docs_schema_migrations",
      ),
      '1,2',
    );
    assert.equal(await metadataDigest(original), before);
    assert.equal(
      await original.sql(
        "SELECT has_table_privilege('doctopus_runtime','docs_build_jobs','INSERT'), has_table_privilege('doctopus_runtime','docs_audit','DELETE'), has_table_privilege('doctopus_runtime','docs_schema_migrations','UPDATE')",
      ),
      't|f|f',
    );
    await original.up();
    const upgraded = await original.client();
    await privateFiles(upgraded, viewer.token);
    assert.equal(
      JSON.parse(
        await upgraded(`/api/projects/${project.id}/publications`, 201, {
          method: 'POST',
          body: payload,
        }),
      ).id,
      publication.id,
    );
    await upgraded(`/api/projects/${project.id}/build-sources`, 200);
    assert.equal(await metadataDigest(original), before);
    await original.select(source.baselineImage);
    await assert.rejects(
      original.compose('run', '--rm', '-T', '--no-deps', 'docs'),
      /Server startup failed/,
    );
    assert.equal(await metadataDigest(original), before);
    await original.close();
    source.step('rollback fresh deployment from pre-upgrade backup');
    const rollback = await prepare('rollback', source.baselineImage, false);
    assert.notEqual(rollback.token, original.token);
    await rollback.backup('restore');
    await rollback.up();
    assert.equal(
      await rollback.sql(
        "SELECT string_agg(version::text,',' ORDER BY version) FROM docs_schema_migrations",
      ),
      '1',
    );
    assert.equal(await metadataDigest(rollback), before);
    const restored = await rollback.client();
    await privateFiles(restored, viewer.token);
    assert.equal(
      JSON.parse(
        await restored(`/api/projects/${project.id}/publications`, 201, {
          method: 'POST',
          body: payload,
        }),
      ).id,
      publication.id,
    );
    await restored('/api/projects', 401, { token: original.token });
    report = {
      serverImage: source.image,
      baselineImage: source.baselineImage,
      baselineCommit: upgradeBaselineCommit,
      artifactId: source.artifactId,
      schemaBefore: 1,
      schemaAfter: 2,
      schemaRestored: 1,
      metadataSha256: before,
      privateFiles: source.paths.length,
      backupFiles: metadata.files,
      checks: [
        'historical-source-image-and-schema-1-installation',
        'private-publication-viewer-token-and-editor-role',
        'pre-upgrade-backup-checksums',
        'new-runtime-refuses-unmigrated-schema',
        'failed-migration-rolls-back-all-new-ddl',
        'matching-migration-preserves-all-durable-v1-metadata',
        'new-runtime-queue-grants-private-files-and-idempotence',
        'old-runtime-refuses-upgraded-database',
        'fresh-target-rollback-restores-schema-1-and-metadata',
        'old-runtime-restored-publication-token-and-rotated-root',
      ],
    };
  } catch (error) {
    failure = error;
  } finally {
    source.step('upgrade and rollback owned fixture cleanup');
    const failures = [];
    for (const fixture of fixtures) {
      try {
        await fixture.close();
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
        'Upgrade, rollback or owned cleanup failed.',
      );
  }
  if (failure) throw failure;
  assert(report);
  return { ...report, cleanupVerified: true };
}
