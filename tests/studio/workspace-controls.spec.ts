import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Exercise presentation preferences independently of authentication. Existing
// Studio journeys continue to verify real sessions, publication and access rules.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).pathname === '/api/me'
          ? { subject: 'workspace-preview', operator: true, oidc: false }
          : [],
    }),
  );
});

test('appearance overrides the system, survives reloads and synchronizes across tabs', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin/');
  const appearance = page.getByRole('combobox', {
    name: 'Appearance',
    exact: true,
  });
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await expect(appearance).toHaveValue('system');
  await appearance.selectOption('dark');
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'background-color',
    'rgb(9, 13, 13)',
  );
  await page.reload();
  await expect(appearance).toHaveValue('dark');
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'background-color',
    'rgb(9, 13, 13)',
  );
  const other = await context.newPage();
  await other.route('**/api/**', (route) =>
    route.fulfill({ json: { subject: null, oidc: false } }),
  );
  await other.goto('/admin/');
  await expect(other.getByRole('combobox', { name: 'Appearance' })).toHaveValue(
    'dark',
  );
  await appearance.selectOption('light');
  await expect(other.getByRole('combobox', { name: 'Appearance' })).toHaveValue(
    'light',
  );
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await appearance.selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'background-color',
    'rgb(9, 13, 13)',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await other.close();
});

test('the sidebar resizes by keyboard and dragging without losing form drafts or legacy saved widths', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('doctopus-studio-navigation-width'))
      localStorage.setItem('doctopus-studio-navigation-width', '288');
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/admin/');
  const separator = page.getByRole('separator', {
    name: 'Resize navigation panel',
  });
  await expect(separator).toHaveAttribute('aria-valuenow', '288');
  await expect(page.getByRole('slider')).toHaveCount(0);
  const draft = page.getByLabel('Project name');
  await draft.fill('Keep this draft');
  await separator.focus();
  await separator.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '304');
  expect(
    (await page.locator('#studio-navigation').boundingBox())!.width,
  ).toBeCloseTo(304, 0);
  await separator.press('Home');
  await expect(separator).toHaveAttribute('aria-valuenow', '200');
  await separator.press('End');
  await expect(separator).toHaveAttribute('aria-valuenow', '360');
  await separator.dblclick();
  await expect(separator).toHaveAttribute('aria-valuenow', '240');
  const bounds = (await separator.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 64, bounds.y + 80, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(separator).toHaveAttribute('aria-valuenow', '304');
  await expect(draft).toHaveValue('Keep this draft');
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', '304');
  expect(
    (await page.locator('#studio-navigation').boundingBox())!.width,
  ).toBeCloseTo(304, 0);
  await page.getByRole('combobox', { name: 'Appearance' }).selectOption('dark');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach('resizable-studio-dark', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('blocked storage preserves usable appearance and sizing controls, including compact enlarged text', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem'])
      Object.defineProperty(Storage.prototype, method, {
        value: () => {
          throw new DOMException('Storage blocked', 'SecurityError');
        },
      });
  });
  await page.goto('/admin/');
  const separator = page.getByRole('separator', {
    name: 'Resize navigation panel',
  });
  await separator.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '256');
  const appearance = page.getByRole('combobox', { name: 'Appearance' });
  await appearance.selectOption('dark');
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'background-color',
    'rgb(9, 13, 13)',
  );
  await page.setViewportSize({ width: 640, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 120));
  await expect
    .poll(async () => {
      const header = (await page.locator('.studio > header').boundingBox())!;
      const navigation = (await page
        .locator('#studio-navigation')
        .boundingBox())!;
      return navigation.y - (header.y + header.height);
    })
    .toBeGreaterThanOrEqual(0);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(separator).toBeHidden();
  await expect(appearance).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(361);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await testInfo.attach('compact-studio-large-text', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('mobile publication and audit tables retain readable columns with keyboard scrolling', async ({
  page,
}) => {
  const id = '12345678-1234-1234-1234-123456789abc';
  await page.unroute('**/api/**');
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json =
      path === '/api/me'
        ? { subject: 'docs-admin', operator: true, oidc: false }
        : path === '/api/projects'
          ? [
              {
                id,
                name: 'Orbit API',
                slug: 'orbit',
                visibility: 'public',
                activePublicationId: 'publication-live',
              },
            ]
          : path.endsWith('/capabilities')
            ? {
                projectId: id,
                publish: true,
                manageAccess: true,
                readAudit: true,
              }
            : path.endsWith('/publications')
              ? [
                  {
                    id: 'publication-live',
                    artifactId: 'a'.repeat(64),
                    subject: 'docs-admin',
                    createdAt: '2026-10-24T12:00:00Z',
                  },
                ]
              : [
                  {
                    id: 'event-1',
                    action: 'publication.activate',
                    actor: 'docs-admin',
                    created_at: '2026-10-24 12:00:00',
                    metadata: { publication: 'publication-live' },
                  },
                ];
    return route.fulfill({ json });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin/');
  for (const appearance of ['light', 'dark']) {
    await page
      .getByRole('combobox', { name: 'Appearance' })
      .selectOption(appearance);
    for (const [tab, label] of [
      ['Publications', 'Scrollable publication history'],
      ['Audit log', 'Scrollable audit events'],
    ] as const) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      const region = page.getByRole('region', { name: label, exact: true });
      await expect(region).toBeVisible();
      expect(
        await region.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      ).toBe(true);
      for (const header of await region.getByRole('columnheader').all())
        expect((await header.boundingBox())!.height).toBeLessThan(48);
      await region.focus();
      await region.press('ArrowRight');
      await expect
        .poll(() => region.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
});
