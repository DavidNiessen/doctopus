import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const api = 'http://127.0.0.1:4174/gallery/api/gallery/v1/serializeparameters/';
const width = async (locator: import('@playwright/test').Locator) =>
  (await locator.boundingBox())!.width;

test('island navigation and inspectors resize with pointer and keyboard, persist and reset', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(api);
  const navigation = page.getByRole('separator', {
    name: 'Resize navigation',
    exact: true,
  });
  const sidebar = page.getByRole('complementary', {
    name: 'Documentation navigation',
  });
  await expect(navigation).toBeVisible();
  const original = await width(sidebar),
    bounds = (await navigation.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 80);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 48, bounds.y + 80, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(() => width(sidebar)).toBeCloseTo(original + 48, 0);
  await navigation.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width(sidebar)).toBeCloseTo(original + 32, 0);
  await page.reload();
  await expect.poll(() => width(sidebar)).toBeCloseTo(original + 32, 0);
  await navigation.dblclick();
  await expect.poll(() => width(sidebar)).toBeCloseTo(original, 0);
  const inspector = page.getByRole('separator', {
    name: 'Resize inspector',
    exact: true,
  });
  await inspector.focus();
  const before = await width(page.locator('#documentation-inspector'));
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => width(page.locator('#documentation-inspector')))
    .toBeGreaterThan(before);
  await inspector.press('Home');
  await expect(inspector).toHaveAttribute('aria-valuenow', '260');
  await inspector.press('End');
  await expect(inspector).toHaveAttribute('aria-valuenow', '560');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await inspector.dblclick();
  await page.screenshot({ path: '.doctopus/island-layout-light.png' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.screenshot({ path: '.doctopus/island-layout-dark.png' });
});

test('playground islands resize independently and stack without overflow on touch screens', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(api + '?playground=open');
  const dialog = page.getByLabel('API playground');
  const handle = dialog.getByRole('separator', {
    name: 'Resize request and response panels',
  });
  const request = dialog.getByRole('region', { name: 'Request configuration' });
  const before = await width(request);
  await handle.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => width(request)).toBeCloseTo(before + 32, 0);
  await handle.press('End');
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  for (const viewport of [
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (viewport.width < 761) await expect(handle).not.toBeVisible();
    else {
      const bounds = (await page.locator('.playground-panels').boundingBox())!;
      const response = (await dialog
        .getByRole('region', { name: 'API response' })
        .boundingBox())!;
      expect(response.x + response.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1,
      );
      expect(response.width).toBeGreaterThanOrEqual(260);
    }
  }
  await page.screenshot({ path: '.doctopus/island-playground-mobile.png' });
  await dialog.getByRole('button', { name: 'Close playground' }).click();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Documentation navigation' }),
  ).toBeVisible();
});

test('islands remain usable without stored layout preferences and without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('Storage disabled');
    };
    Storage.prototype.setItem = () => {
      throw new Error('Storage disabled');
    };
  });
  await page.goto(api);
  const resize = page.getByRole('separator', {
    name: 'Resize navigation',
    exact: true,
  });
  await resize.press('End');
  await expect(resize).toHaveAttribute('aria-valuenow', '380');
  await resize.press('Home');
  await expect(resize).toHaveAttribute('aria-valuenow', '220');
  await context.close();
  const offline = await browser.newContext({ javaScriptEnabled: false });
  const noJs = await offline.newPage();
  await noJs.goto(api);
  await expect(noJs.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    noJs.getByRole('complementary', { name: 'Documentation navigation' }),
  ).toBeVisible();
  expect(
    await noJs.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(noJs.getByRole('separator')).toHaveCount(0);
  await offline.close();
});

test('Studio uses responsive islands with a persistent accessible navigation width', async ({
  page,
}) => {
  const { readFile } = await import('node:fs/promises');
  await page.route('http://127.0.0.1:4173/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname.slice(
      '/admin/'.length,
    );
    if (path && !/^assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path))
      return route.abort();
    await route.fulfill({
      contentType: path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : 'text/html',
      body: await readFile('apps/studio/dist/client/' + (path || 'index.html')),
    });
  });
  await page.route('http://127.0.0.1:4173/api/me', (route) =>
    route.fulfill({
      json: { subject: 'layout-review', operator: true, oidc: false },
    }),
  );
  await page.route('http://127.0.0.1:4173/api/projects', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:4173/admin/');
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  const divider = page.getByRole('separator', {
    name: 'Resize navigation panel',
  });
  await expect(page.getByRole('slider')).toHaveCount(0);
  await divider.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '360');
  await expect
    .poll(() => width(page.locator('.studio-layout > aside')))
    .toBe(360);
  await page.reload();
  await expect(divider).toHaveAttribute('aria-valuenow', '360');
  await expect
    .poll(() => width(page.locator('.studio-layout > aside')))
    .toBe(360);
  await page.screenshot({ path: '.doctopus/island-studio-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(divider).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'Access control', exact: false })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Access control', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: '.doctopus/island-studio-mobile.png' });
});
