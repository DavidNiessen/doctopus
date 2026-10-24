import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { promotionPredicateType } from '../lib/container-publication.mjs';

const workflow = parse(
  await readFile(
    new URL('../../.github/workflows/release-publish.yml', import.meta.url),
    'utf8',
  ),
);
const action = parse(
  await readFile(
    new URL(
      '../../.github/actions/verify-publication/action.yml',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('publication is manual and read-only by default; each writer needs policy verification and a protected environment', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(
    workflow.on.workflow_dispatch.inputs['confirm-publication'].default,
    false,
  );
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert(
    Object.values(workflow.jobs.plan.permissions).every(
      (value) => value === 'read',
    ),
  );
  for (const kind of ['npm', 'maven', 'container']) {
    const job = workflow.jobs['publish-' + kind];
    assert.equal(job.if, 'inputs.confirm-publication');
    assert.deepEqual(job.needs, ['plan', 'preflight']);
    assert.equal(job.environment, 'release');
    assert.equal(job.permissions.contents, 'read');
    assert.equal(
      job.permissions['id-token'],
      kind === 'container' ? 'write' : undefined,
    );
    assert.equal(job.permissions.packages, 'write');
    assert.equal(
      job.env,
      undefined,
      'Signing credentials must never be job-wide.',
    );
    const verification = job.steps.findIndex(
      (step) => step.uses === './.github/actions/verify-publication',
    );
    assert(verification >= 0);
    assert.equal(job.steps[verification].with['require-approval'], 'true');
    const publishing = job.steps.findIndex(
      (step) => step.run === `node scripts/publish-${kind}.mjs`,
    );
    if (kind !== 'container')
      assert.equal(
        job.steps[publishing].env.GITHUB_PACKAGES_TOKEN,
        '${{ github.token }}',
      );
    assert(publishing > verification);
    assert(
      job.steps
        .slice(verification + 1, publishing)
        .some(
          (step) =>
            step.uses === './.github/actions/verify-publication-preflight',
        ),
    );
    for (const step of job.steps)
      if (step.uses && !step.uses.startsWith('./'))
        assert.match(step.uses, /^[a-zA-Z0-9._/-]+@[a-f0-9]{40}$/);
  }
});

test('a confirmed publication rescans accepted bytes and attests only reports created by its preflight job', () => {
  const job = workflow.jobs.preflight;
  assert.equal(job.if, 'inputs.confirm-publication');
  assert.equal(job.needs, 'plan');
  assert.equal(job.environment, undefined);
  assert.equal(job.permissions.packages, undefined);
  assert(!JSON.stringify(job).includes('secrets.'));
  assert(
    job.steps.some(
      (step) => step.run === 'node scripts/scan-publication-candidate.mjs',
    ),
  );
  const attest = job.steps.find((step) =>
    step.uses?.startsWith('actions/attest-build-provenance@'),
  );
  assert.equal(
    attest.with['subject-path'],
    '.doctopus/publication-preflight/*',
  );
  assert(!job.steps.some((step) => step.run?.includes('docker build')));
});

test('fresh registry consumers receive only read permissions and the aggregate rejects skipped gates', () => {
  for (const kind of ['npm', 'maven', 'container']) {
    const job = workflow.jobs['verify-' + kind];
    assert.equal(job.needs, 'publish-' + kind);
    assert.equal(job.environment, undefined);
    assert(Object.values(job.permissions).every((value) => value === 'read'));
    assert.equal(
      job.permissions.packages,
      kind === 'container' ? undefined : 'read',
    );
    assert(!JSON.stringify(job).includes('secrets.'));
    assert.equal(job.env, undefined);
    assert(
      job.steps.some(
        (step) => step.run === `node scripts/verify-published-${kind}.mjs`,
      ),
    );
  }
  const aggregate = workflow.jobs.acceptance;
  assert.deepEqual(aggregate.needs, [
    'plan',
    'verify-npm',
    'verify-maven',
    'verify-container',
  ]);
  assert.equal(aggregate.if, 'always() && inputs.confirm-publication');
  assert.deepEqual(aggregate.permissions, {});
  assert(aggregate.steps[0].run.includes('test "$result" = success'));
});

test('the container publisher signs a promotion predicate rather than claiming it built the image', () => {
  const steps = workflow.jobs['publish-container'].steps;
  const attest = steps.find((step) => step.uses?.startsWith('actions/attest@'));
  assert(attest);
  assert.equal(attest.with['predicate-type'], promotionPredicateType);
  assert.equal(attest.with['push-to-registry'], true);
  assert.equal(
    attest.with['subject-digest'],
    '${{ steps.container.outputs.digest }}',
  );
  assert(
    !steps.some((step) =>
      step.uses?.startsWith('actions/attest-build-provenance@'),
    ),
  );
});

test('the shared verification action preserves argument boundaries and rejects ambiguous approval inputs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'ad-publication-action-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'package.json'), '{"type":"commonjs"}\n');
  const log = join(root, 'argv.json');
  await writeFile(
    join(bin, 'node'),
    '#!' +
      process.execPath +
      '\n' +
      "require('node:fs').writeFileSync(process.env.ARGUMENT_LOG,JSON.stringify(process.argv.slice(2)));\n",
    { mode: 0o700 },
  );
  const exec = promisify(execFile);
  const script = action.runs.steps.at(-1).run;
  const env = {
    ...process.env,
    PATH: bin + delimiter + process.env.PATH,
    ARGUMENT_LOG: log,
    CANDIDATE_RUN_ID: '123; touch INJECTED',
    CANDIDATE_RUN_ATTEMPT: '$(touch INJECTED)',
    REQUIRE_APPROVAL: 'true',
  };
  await exec('bash', ['-c', script], { cwd: root, env });
  assert.deepEqual(JSON.parse(await readFile(log)), [
    'scripts/check-publication.mjs',
    env.CANDIDATE_RUN_ID,
    env.CANDIDATE_RUN_ATTEMPT,
    '--require-approval',
  ]);
  await assert.rejects(readFile(join(root, 'INJECTED')));
  await rm(log);
  await assert.rejects(
    exec('bash', ['-c', script], {
      cwd: root,
      env: { ...env, REQUIRE_APPROVAL: 'yes' },
    }),
  );
  await assert.rejects(readFile(log));
});
