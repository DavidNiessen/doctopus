import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Project } from '@davidniessen/doctopus-domain';

const headers = () => ({
  authorization: 'Bearer ' + process.env.TEST_ROOT_TOKEN!,
});
async function createProject(request: APIRequestContext) {
  const response = await request.post('/api/projects', {
    headers: headers(),
    data: {
      name: 'Session browser ' + randomUUID(),
      slug: 'session-' + randomUUID(),
      visibility: 'private',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Project;
}
async function connect(
  page: Page,
  project: Project,
  token = process.env.TEST_ROOT_TOKEN!,
) {
  await page.goto('/admin/');
  await page.getByLabel('Operator or project token').fill(token);
  await page.getByRole('button', { name: 'Connect to workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Current project').selectOption(project.id);
}
async function holdResponse(
  page: Page,
  pattern: string,
  method: string,
  replacement?: unknown,
) {
  let received!: (value: unknown) => void,
    release!: () => void,
    finished!: () => void;
  const body = new Promise<unknown>((resolve) => {
    received = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const settled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(
    pattern,
    async (route) => {
      if (route.request().method() !== method) return route.fallback();
      const response = await route.fetch();
      received(await response.json());
      await released;
      // Navigation deliberately cancels the browser request before delivery.
      await route
        .fulfill({
          response,
          ...(replacement === undefined ? {} : { json: replacement }),
        })
        .catch(() => {});
      finished();
    },
    { times: 1 },
  );
  return { body, release, settled };
}

test('late publication history cannot replace the selected project or its status', async ({
  page,
  request,
}) => {
  const a = await createProject(request),
    b = await createProject(request);
  await connect(page, a);
  const publication = (subject: string) => ({
    id: randomUUID(),
    artifactId: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
    subject,
  });
  const delayed = await holdResponse(
    page,
    `**/api/projects/${a.id}/publications`,
    'GET',
    [publication('Previous project A')],
  );
  await page.route(`**/api/projects/${b.id}/publications`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: [publication('Current project B')] });
  });
  try {
    await page
      .getByRole('button', { name: 'Publications', exact: true })
      .click();
    await delayed.body;
    await page.getByLabel('Current project').selectOption(b.id);
    await expect(
      page.getByRole('cell', { name: /Current project B/ }),
    ).toBeVisible();
    delayed.release();
    await delayed.settled;
    await expect(
      page.getByRole('cell', { name: /Previous project A/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('cell', { name: /Current project B/ }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    delayed.release();
  }
});

test('a token acknowledgement from a previous project or signed-out session cannot reappear', async ({
  page,
  request,
}) => {
  const a = await createProject(request),
    b = await createProject(request);
  await connect(page, a);
  await page
    .getByRole('button', { name: 'Access control', exact: true })
    .click();
  const delayed = await holdResponse(
    page,
    `**/api/projects/${a.id}/tokens`,
    'POST',
  );
  let later: Awaited<ReturnType<typeof holdResponse>> | undefined;
  try {
    await page
      .getByLabel('Label', { exact: true })
      .fill('Previous project token');
    await page
      .getByRole('button', { name: 'Create token', exact: true })
      .click();
    const created = (await delayed.body) as { id: string; token: string };
    const authorized = await request.get(`/api/projects/${a.id}/publications`, {
      headers: { authorization: 'Bearer ' + created.token },
    });
    expect(authorized.ok()).toBe(true);
    await page.getByLabel('Current project').selectOption(b.id);
    await expect(page.getByLabel('Label', { exact: true })).toHaveValue('');
    delayed.release();
    await delayed.settled;
    await expect(page.getByLabel('Token (shown once)')).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Token id:' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Create token', exact: true }),
    ).toBeEnabled();
    later = await holdResponse(page, `**/api/projects/${b.id}/tokens`, 'POST');
    await page.getByLabel('Label', { exact: true }).fill('Pending at sign-out');
    await page
      .getByRole('button', { name: 'Create token', exact: true })
      .click();
    const signedOutToken = (await later.body) as { id: string; token: string };
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Welcome to your workspace' }),
    ).toBeVisible();
    later.release();
    await later.settled;
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.content()).not.toContain(signedOutToken.token);
    await connect(page, b);
    await page
      .getByRole('button', { name: 'Access control', exact: true })
      .click();
    await expect(page.getByLabel('Token (shown once)')).toHaveCount(0);
    expect(await page.content()).not.toContain(created.token);
    for (const [project, id] of [
      [a, created.id],
      [b, signedOutToken.id],
    ] as const) {
      const revoked = await request.delete(
        `/api/projects/${project.id}/tokens/${id}`,
        { headers: headers() },
      );
      expect(revoked.ok()).toBe(true);
    }
  } finally {
    delayed.release();
    later?.release();
  }
});

test('permission failures retain the session while revoked credentials clear private Studio state', async ({
  page,
  request,
}) => {
  const project = await createProject(request);
  const issued = await request.post(`/api/projects/${project.id}/tokens`, {
    headers: headers(),
    data: {
      label: 'Expiring Studio fixture',
      role: 'viewer',
      expiresInDays: 1,
    },
  });
  expect(issued.status()).toBe(201);
  const token = (await issued.json()) as { id: string; token: string };
  // Stale advisory permissions cannot grant publication rights on the server.
  await page.route(
    `**/api/projects/${project.id}/capabilities`,
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        ...(response.ok()
          ? {
              json: {
                projectId: project.id,
                publish: true,
                manageAccess: false,
                readAudit: false,
              },
            }
          : {}),
      });
    },
  );
  await connect(page, project, token.token);
  await page.getByRole('button', { name: 'Publications', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/denied|forbidden/i);
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  const revoked = await request.delete(
    `/api/projects/${project.id}/tokens/${token.id}`,
    { headers: headers() },
  );
  expect(revoked.ok()).toBe(true);
  await page
    .getByRole('button', { name: 'Refresh projects', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Welcome to your workspace' }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Your session has expired',
  );
  await expect(page.getByLabel('Current project')).toHaveCount(0);
  expect(await page.content()).not.toContain(project.name);
  await page
    .getByLabel('Operator or project token')
    .fill(process.env.TEST_ROOT_TOKEN!);
  await page.getByRole('button', { name: 'Connect to workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
});

test('late startup authentication failures cannot overwrite a completed sign-in', async ({
  page,
  request,
}) => {
  const project = await createProject(request);
  let received!: () => void, release!: () => void, finished!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    received = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const settled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(
    '**/api/me',
    async (route) => {
      received();
      await released;
      await route
        .fulfill({ status: 503, json: { error: 'Obsolete startup failure' } })
        .catch(() => {});
      finished();
    },
    { times: 1 },
  );
  try {
    await page.goto('/admin/');
    await intercepted;
    await page
      .getByLabel('Operator or project token')
      .fill(process.env.TEST_ROOT_TOKEN!);
    await page.getByRole('button', { name: 'Connect to workspace' }).click();
    await expect(
      page.getByRole('heading', { name: 'Overview', exact: true }),
    ).toBeVisible();
    release();
    await settled;
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByLabel('Current project').selectOption(project.id);
    await page
      .getByRole('button', { name: 'Publications', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Verify and publish' }),
    ).toBeEnabled();
  } finally {
    release();
  }
});

test('uncertain server sign-out remains visible and can be retried', async ({
  page,
  request,
}) => {
  const project = await createProject(request);
  await connect(page, project);
  await page.route('**/auth/logout', (route) => route.abort(), { times: 1 });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Server sign-out could not be confirmed',
  );
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome to your workspace' }),
  ).toBeVisible();
});
