import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Project, Role } from '@davidniessen/doctopus-domain';

const headers = () => ({
  authorization: 'Bearer ' + process.env.TEST_ROOT_TOKEN!,
});
async function createProject(request: APIRequestContext) {
  const response = await request.post('/api/projects', {
    headers: headers(),
    data: {
      name: 'Permissions ' + randomUUID(),
      slug: 'permissions-' + randomUUID(),
      visibility: 'private',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Project;
}
async function credential(
  request: APIRequestContext,
  project: Project,
  role: Role,
) {
  const response = await request.post(`/api/projects/${project.id}/tokens`, {
    headers: headers(),
    data: { label: 'Permissions browser fixture', role, expiresInDays: 1 },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { token: string }).token;
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
  await expect(
    page.getByRole('status').filter({ hasText: 'Loading project permissions' }),
  ).toHaveCount(0);
}

test('viewer, editor, publisher and administrator navigation follows actual project permissions', async ({
  page,
  request,
  browser,
}) => {
  const project = await createProject(request);
  for (const role of ['viewer', 'editor', 'publisher', 'admin'] as const) {
    const context = await browser.newContext();
    try {
      const member = await context.newPage();
      await connect(member, project, await credential(request, project, role));
      await expect(
        member.getByRole('heading', { name: 'Create a project', exact: true }),
      ).toHaveCount(0);
      await expect(
        member.getByRole('button', { name: 'Publications', exact: true }),
      ).toHaveCount(['publisher', 'admin'].includes(role) ? 1 : 0);
      for (const name of ['Access control', 'Audit log'])
        await expect(
          member.getByRole('button', { name, exact: true }),
        ).toHaveCount(role === 'admin' ? 1 : 0);
      if (role === 'publisher') {
        await member
          .getByRole('button', { name: 'Publications', exact: true })
          .click();
        await expect(
          member.getByRole('button', { name: 'Verify and publish' }),
        ).toBeEnabled();
      }
      if (role === 'admin') {
        await member
          .getByRole('button', { name: 'Access control', exact: true })
          .click();
        await expect(
          member.getByRole('button', { name: 'Create token', exact: true }),
        ).toBeEnabled();
        await member
          .getByRole('button', { name: 'Audit log', exact: true })
          .click();
        await expect(
          member
            .getByRole('cell', { name: 'token.created', exact: true })
            .first(),
        ).toBeVisible();
      }
      await expect(member.getByRole('alert')).toHaveCount(0);
    } finally {
      await context.close();
    }
  }
  await connect(page, project);
  await expect(
    page.getByRole('heading', { name: 'Create a project', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Current project').selectOption('');
  await page.getByRole('button', { name: 'Publications', exact: true }).click();
  await expect(
    page.getByText('Select a project to view its available actions.'),
  ).toBeVisible();
  await expect(page.getByLabel('Artifact SHA-256')).toHaveCount(0);
});

test('refreshing permissions removes actions and drafts after a role reduction', async ({
  page,
  request,
}) => {
  const project = await createProject(request);
  let reduced = false;
  await page.route(
    `**/api/projects/${project.id}/capabilities`,
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        ...(reduced
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
  await connect(page, project, await credential(request, project, 'admin'));
  await page
    .getByRole('button', { name: 'Access control', exact: true })
    .click();
  await page
    .getByLabel('Label', { exact: true })
    .fill('Draft before reduction');
  reduced = true;
  await page
    .getByRole('button', { name: 'Refresh projects', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Access control', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Audit log', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Label', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Publications', exact: true }),
  ).toBeVisible();
});

test('invalid project-bound permissions withhold mutation forms until a successful retry', async ({
  page,
  request,
}) => {
  const project = await createProject(request);
  const pattern = `**/api/projects/${project.id}/capabilities`;
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: {
        projectId: randomUUID(),
        publish: true,
        manageAccess: true,
        readAudit: true,
      },
    });
  });
  await connect(page, project);
  await expect(page.getByRole('alert')).toContainText(
    'Invalid project permissions',
  );
  await page.getByRole('button', { name: 'Publications', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Invalid project permissions',
  );
  await expect(page.getByLabel('Artifact SHA-256')).toHaveCount(0);
  await page.unroute(pattern);
  await page.getByRole('button', { name: 'Retry permissions' }).click();
  await expect(
    page.getByRole('button', { name: 'Verify and publish' }),
  ).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('lost project membership clears the selected project while retaining sign-out and project refresh', async ({
  page,
  request,
}) => {
  const project = await createProject(request);
  await connect(page, project, await credential(request, project, 'admin'));
  await page.route(
    `**/api/projects/${project.id}/capabilities`,
    (route) =>
      route.fulfill({ status: 403, json: { error: 'Project access denied' } }),
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Refresh projects', exact: true })
    .click();
  await expect(page.getByLabel('Current project')).toHaveValue('');
  await expect(
    page.getByLabel('Current project').locator(`option[value="${project.id}"]`),
  ).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Project access changed');
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Refresh projects', exact: true })
    .click();
  await expect(
    page.getByLabel('Current project').locator(`option[value="${project.id}"]`),
  ).toHaveCount(1);
  await page.getByLabel('Current project').selectOption(project.id);
  await expect(
    page.getByRole('button', { name: 'Access control', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
