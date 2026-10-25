import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const root = 'http://127.0.0.1:4174/gallery';

test('home respects the layout default while explicit guide links still open documentation', async ({
  page,
}) => {
  await page.goto(root + '/');
  const sections = page.getByRole('navigation', {
    name: 'Documentation sections',
  });
  await expect(
    sections.getByRole('button', { name: 'All', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const guide = await page
    .locator('.nav-group a[data-doc-route]:not(.endpoint-link)')
    .first()
    .getAttribute('href');
  expect(guide).toBeTruthy();
  const firstEndpoint = await page
    .locator('.endpoint-link[data-doc-route]')
    .first()
    .getAttribute('href');
  let releaseHome = () => {};
  const pendingHome = new Promise<void>((resolve) => {
    releaseHome = resolve;
  });
  await page.route(
    new URL(firstEndpoint! + 'page-data.json', root).href,
    async (route) => {
      await pendingHome;
      await route.continue();
    },
    { times: 1 },
  );
  await page
    .getByRole('button', { name: 'Open reader settings', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('classic');
  await page.keyboard.press('Escape');
  await expect(
    sections.getByRole('button', { name: 'API Reference', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  releaseHome();
  await expect(
    page.getByRole('region', { name: 'API endpoint reference' }),
  ).toBeVisible();
  await expect(
    sections.getByRole('button', { name: 'API Reference', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    sections.getByRole('button', { name: 'All', exact: true }),
  ).toHaveCount(0);
  await page.goto(root + '/');
  await expect(
    page.getByRole('region', { name: 'API endpoint reference' }),
  ).toBeVisible();
  await page.goto(new URL(guide!, root).href);
  await expect(
    sections.getByRole('button', { name: 'Documentation', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.guide-content')).toBeVisible();
  await page
    .getByRole('button', { name: 'Open reader settings', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('modern');
  await page.keyboard.press('Escape');
  await page.goto(root + '/');
  await expect(
    sections.getByRole('button', { name: 'All', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('slow navigation uses an inline skeleton and clears it when the page arrives', async ({
  page,
}) => {
  await page.goto(root + '/api/gallery/v1/health/');
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/serializeparameters/page-data.json', async (route) => {
    await pending;
    await route.continue();
  });
  await page
    .locator(
      'a[data-doc-route][href="/gallery/api/gallery/v1/serializeparameters/"]',
    )
    .first()
    .click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.page-loading')).toHaveCount(0);
  await expect(page.locator('.page-skeleton')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  release();
  await expect(page).toHaveURL(/serializeparameters\/$/);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.page-skeleton')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Try now', exact: true }),
  ).toBeVisible();
});
