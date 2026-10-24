import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildSite,
  inspectIsolatedSource,
  stageArtifact,
} from '@davidniessen/doctopus-cli';
import { readBuildPolicy, toolVersion } from '@davidniessen/doctopus-contracts';
import type {
  BuildJob,
  BuildLease,
  BuildSource,
  Project,
  BuildPage,
  Role,
} from '@davidniessen/doctopus-domain';

const headers = () => ({
  authorization: 'Bearer ' + process.env.TEST_ROOT_TOKEN!,
});
const policy = readBuildPolicy({ image: 'sha256:' + 'a'.repeat(64) });
const snapshot = {
  digestVersion: 2 as const,
  digest: 'b'.repeat(64),
  files: 1,
  bytes: 1,
};
const temporary: string[] = [];
test.afterAll(async () => {
  for (const directory of temporary)
    await rm(directory, { recursive: true, force: true });
});
async function project(request: APIRequestContext) {
  const response = await request.post('/api/projects', {
    headers: headers(),
    data: {
      name: 'Build browser ' + randomUUID(),
      slug: 'build-' + randomUUID(),
      visibility: 'private',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Project;
}
async function approve(
  request: APIRequestContext,
  item: Project,
  label = 'Reviewed source',
) {
  const response = await request.post(
    `/api/projects/${item.id}/build-sources`,
    {
      headers: headers(),
      data: { label, snapshot, policy, idempotencyKey: randomUUID() },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as BuildSource;
}
async function connect(
  page: Page,
  item: Project,
  token = process.env.TEST_ROOT_TOKEN!,
) {
  await page.goto('/admin/');
  await page.getByLabel('Operator or project token').fill(token);
  await page.getByRole('button', { name: 'Connect to workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Current project').selectOption(item.id);
  await page.getByRole('button', { name: 'Builds', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Refresh builds' }),
  ).toBeEnabled();
}
async function jobs(request: APIRequestContext, item: Project) {
  const response = await request.get(`/api/projects/${item.id}/builds`, {
    headers: headers(),
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as BuildPage<BuildJob>;
}
async function claim(request: APIRequestContext, source: BuildSource) {
  const response = await request.post('/api/build-workers/claim', {
    headers: headers(),
    data: { workerId: 'studio-browser-worker', sourceIds: [source.id] },
  });
  expect(response.ok()).toBe(true);
  const data = (await response.json()) as { lease: BuildLease };
  expect(data.lease).toBeTruthy();
  return data.lease;
}
async function credential(
  request: APIRequestContext,
  item: Project,
  role: Role,
) {
  const response = await request.post(`/api/projects/${item.id}/tokens`, {
    headers: headers(),
    data: { label: 'Build browser acceptance', role, expiresInDays: 1 },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

test('operator approves and queues reviewed input, then explicitly publishes the completed artifact', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const item = await project(request);
  const root = await mkdtemp(join(tmpdir(), 'doctopus-studio-build-'));
  temporary.push(root);
  await cp(resolve('examples/demo'), root, {
    recursive: true,
    filter: (file) =>
      !file.includes('.doctopus') && !file.includes('.api-docs'),
  });
  const config = join(root, 'docs.config.yaml');
  await writeFile(
    config,
    (await readFile(config, 'utf8')) + `\nbasePath: /docs/${item.slug}\n`,
  );
  const inspected = await inspectIsolatedSource(root);
  await connect(page, item);
  await page.locator('.source-approval > summary').click();
  await page
    .getByLabel('Source label', { exact: true })
    .fill('Browser approved source');
  await page
    .getByLabel('Source snapshot JSON')
    .fill(JSON.stringify({ schemaVersion: 1, source: inspected }));
  await page.getByLabel('Approved builder image').fill(policy.image);
  await page
    .getByRole('button', { name: 'Approve source', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Source approved.' }),
  ).toBeVisible();
  const response = await request.get(`/api/projects/${item.id}/build-sources`, {
    headers: headers(),
  });
  const source = ((await response.json()) as BuildPage<BuildSource>).items[0]!;
  expect(source.snapshot).toEqual(inspected);
  expect(source.policy).toEqual(policy);
  await page
    .getByLabel('Approved source', { exact: true })
    .selectOption(source.id);
  await page.getByRole('button', { name: 'Queue build', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Build queued.' }),
  ).toBeVisible();
  const lease = await claim(request, source);
  const built = await buildSite(root);
  const artifactId = await stageArtifact(
    built.directory,
    resolve('.doctopus/studio-test/artifacts'),
  );
  temporary.push(resolve('.doctopus/studio-test/artifacts', artifactId));
  const completed = await request.post(
    `/api/projects/${item.id}/builds/${lease.job.id}/complete`,
    {
      headers: headers(),
      data: {
        token: lease.token,
        result: {
          artifactId,
          source: inspected,
          requestedImage: policy.image,
          resolvedImage: policy.image,
          toolVersion,
          durationMs: 1,
        },
      },
    },
  );
  expect(completed.ok()).toBe(true);
  await page.getByRole('button', { name: 'Refresh builds' }).click();
  await expect(page.getByText('Succeeded', { exact: true })).toBeVisible();
  const projects = await request.get('/api/projects', { headers: headers() });
  expect(
    ((await projects.json()) as Project[]).find((value) => value.id === item.id)
      ?.activePublicationId,
  ).toBeNull();
  await page
    .getByRole('button', { name: /^Review artifact from build / })
    .click();
  await expect(page.getByLabel('Artifact SHA-256')).toHaveValue(artifactId);
  await page.getByRole('button', { name: 'Verify and publish' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Publication activated' }),
  ).toBeVisible();
  const documentation = await page.context().newPage();
  await documentation.goto(`/docs/${item.slug}/`);
  await expect(
    documentation.getByRole('heading', { name: 'Introduction', exact: true }),
  ).toBeVisible();
  await documentation.close();
  expect(await page.content()).not.toContain(lease.token);
  expect(await page.content()).not.toContain(process.env.TEST_ROOT_TOKEN!);
});

test('lost enqueue acknowledgement retries the same action across navigation; running builds and approvals can be cancelled', async ({
  page,
  request,
}) => {
  const item = await project(request),
    source = await approve(request, item);
  await connect(page, item);
  const keys: string[] = [];
  await page.route(`**/api/projects/${item.id}/builds`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(
      (route.request().postDataJSON() as { idempotencyKey: string })
        .idempotencyKey,
    );
    if (keys.length === 1) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByLabel('Approved source', { exact: true })
    .selectOption(source.id);
  await page.getByRole('button', { name: 'Queue build', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Action needs confirmation' }),
  ).toBeVisible();
  expect((await jobs(request, item)).items).toHaveLength(1);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Builds', exact: true }).click();
  await page.getByRole('button', { name: 'Retry pending action' }).click();
  await expect(
    page.getByRole('region', { name: 'Pending build action' }),
  ).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect((await jobs(request, item)).items).toHaveLength(1);
  await claim(request, source);
  await page.getByRole('button', { name: 'Refresh builds' }).click();
  await expect(page.getByText('Running', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Cancel build / }).click();
  await expect(
    page.getByText('Cancelled', { exact: true }).first(),
  ).toBeVisible();
  const queued = await request.post(`/api/projects/${item.id}/builds`, {
    headers: headers(),
    data: { sourceId: source.id, idempotencyKey: randomUUID() },
  });
  expect(queued.status()).toBe(201);
  await page.locator('.build-source > summary').click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page
    .getByRole('button', { name: 'Revoke source', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Source approval revoked.' }),
  ).toBeVisible();
  expect(
    (await jobs(request, item)).items.every(
      (value) => value.state === 'cancelled',
    ),
  ).toBe(true);
  await page.getByLabel('Include revoked sources').check();
  await expect(page.locator('.build-source .badge')).toHaveText('Revoked');
  await expect(
    page.getByRole('button', { name: 'Revoke source', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByLabel('Approved source', { exact: true })
      .locator(`option[value="${source.id}"]`),
  ).toHaveJSProperty('disabled', true);
});

test('current project and role determine available actions and late responses cannot replace another project', async ({
  page,
  request,
  browser,
}) => {
  const a = await project(request),
    b = await project(request);
  const sourceA = await approve(request, a, 'Only project A');
  const sourceB = await approve(request, b, '<img src=x onerror=alert(1)>');
  await connect(page, a);
  await expect(page.locator('.build-source > summary')).toContainText(
    sourceA.label,
  );
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route(`**/api/projects/${a.id}/builds`, async (route) => {
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Refresh builds' }).click();
  await intercepted;
  await page.getByLabel('Current project').selectOption(b.id);
  await expect(page.locator('.build-source > summary')).toContainText(
    sourceB.label,
  );
  release();
  await expect(page.locator('.build-source > summary')).not.toContainText(
    sourceA.label,
  );
  await expect(page.locator('.build-source img')).toHaveCount(0);
  for (const role of ['viewer', 'editor'] as const) {
    const context = await browser.newContext();
    try {
      const member = await context.newPage();
      await connect(member, b, await credential(request, b, role));
      await expect(member.locator('.build-source > summary')).toContainText(
        sourceB.label,
      );
      await expect(member.locator('.source-approval')).toHaveCount(0);
      await member.locator('.build-source > summary').click();
      await expect(
        member.getByRole('button', { name: 'Revoke source', exact: true }),
      ).toHaveCount(0);
      await expect(
        member.getByRole('button', { name: 'Queue build', exact: true }),
      ).toHaveCount(role === 'editor' ? 1 : 0);
      if (role === 'editor') {
        await member
          .getByLabel('Approved source', { exact: true })
          .selectOption(sourceB.id);
        await member
          .getByRole('button', { name: 'Queue build', exact: true })
          .click();
        await expect(
          member.getByRole('button', { name: /^Cancel build / }),
        ).toBeEnabled();
        await member.getByRole('button', { name: /^Cancel build / }).click();
        await expect(
          member.getByText('Cancelled', { exact: true }).first(),
        ).toBeVisible();
      }
    } finally {
      await context.close();
    }
  }
});

test('bounded history and source pages remain accessible without overflowing a mobile viewport', async ({
  page,
  request,
}) => {
  const item = await project(request),
    source = await approve(request, item);
  const sourceRows = Array.from({ length: 100 }, (_, index) => ({
    ...source,
    id: randomUUID(),
    label: `Reviewed source ${index}`,
  }));
  const now = new Date().toISOString();
  const jobRows = Array.from({ length: 100 }, () => ({
    id: randomUUID(),
    projectId: item.id,
    sourceId: source.id,
    state: 'failed',
    attempts: 1,
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
    workerId: null,
    artifactId: null,
    errorCode: 'build_failed',
  }));
  await page.route(
    `**/api/projects/${item.id}/build-sources?*`,
    async (route) => {
      const after = new URL(route.request().url()).searchParams.get('after');
      await route.fulfill({
        json: {
          items: after ? [source] : sourceRows,
          nextCursor: after ? null : sourceRows[99]!.id,
        },
      });
    },
  );
  await page.route(`**/api/projects/${item.id}/builds*`, async (route) => {
    const after = new URL(route.request().url()).searchParams.get('after');
    await route.fulfill({
      json: {
        items: after ? [jobRows[0]] : jobRows,
        nextCursor: after ? null : jobRows[99]!.id,
      },
    });
  });
  await connect(page, item);
  await expect(page.locator('tbody tr')).toHaveCount(100);
  await page.getByRole('button', { name: 'Older builds' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: 'Older builds' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Newer builds' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(100);
  await page
    .getByLabel('Approved source', { exact: true })
    .selectOption(sourceRows[0]!.id);
  await expect(
    page.getByRole('button', { name: 'Queue build', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Older sources' }).click();
  await expect(page.locator('.build-source')).toHaveCount(1);
  await expect(page.getByLabel('Approved source', { exact: true })).toHaveValue(
    '',
  );
  await expect(
    page.getByRole('button', { name: 'Queue build', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Newer sources' }).click();
  await expect(page.locator('.build-source')).toHaveCount(100);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.source-approval > summary').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: '.doctopus/studio-builds-mobile.png',
    fullPage: false,
  });
});

test('repositories without build support retain the existing Studio navigation', async ({
  page,
  request,
}) => {
  const item = await project(request);
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), builds: false },
    });
  });
  await page.goto('/admin/');
  await page
    .getByLabel('Operator or project token')
    .fill(process.env.TEST_ROOT_TOKEN!);
  await page.getByRole('button', { name: 'Connect to workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Current project').selectOption(item.id);
  await expect(
    page.getByRole('button', { name: 'Builds', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Publications', exact: true }),
  ).toBeVisible();
});
