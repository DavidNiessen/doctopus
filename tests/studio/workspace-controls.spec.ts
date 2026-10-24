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
    'rgb(24, 24, 27)',
  );
  await page.reload();
  await expect(appearance).toHaveValue('dark');
  await expect(page.locator('.workspace-main')).toHaveCSS(
    'background-color',
    'rgb(24, 24, 27)',
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
    'rgb(24, 24, 27)',
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
    'rgb(24, 24, 27)',
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
    .toBeGreaterThanOrEqual(10);
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
