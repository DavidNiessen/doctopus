import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const root = 'http://127.0.0.1:4174/gallery';
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function classic(page: import('@playwright/test').Page) {
  await page.goto(root + '/api/gallery/v1/health/');
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await page
    .getByRole('dialog', { name: 'Reader settings', exact: true })
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('classic');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'API endpoint reference' }),
  ).toBeVisible();
  await expect(page.locator('.endpoint-disclosure').first()).toBeVisible();
}
test('classic reference lists collapsed endpoints in the main page and lazily opens a shareable working playground', async ({
  page,
}) => {
  const dataRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('page-data.json'))
      dataRequests.push(request.url());
  });
  await classic(page);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await expect(page.locator('.sidebar .endpoint-link')).toHaveCount(0);
  await expect(page.locator('.endpoint-disclosure[open]')).toHaveCount(0);
  expect(dataRequests).toEqual([]);
  const row = page.locator('#classic-0-serializeparameters');
  await row.locator('summary').first().focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('open', '');
  await expect(
    row.getByRole('heading', { name: 'Query parameters', exact: true }),
  ).toBeVisible();
  expect(dataRequests).toEqual([
    root + '/api/gallery/v1/serializeparameters/page-data.json',
  ]);
  const trigger = row
    .locator('..')
    .getByRole('button', { name: 'Try now', exact: true });
  await trigger.click();
  const dialog = page.getByLabel('API playground');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Request URL', { exact: true })).toContainText(
    '/serialization/',
  );
  await dialog
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const response = page.waitForResponse(
    (item) =>
      item.url().includes('/v1/serialization/') &&
      item.request().method() === 'GET',
  );
  await dialog.getByRole('button', { name: 'Send request' }).click();
  expect((await response).status()).toBe(200);
  const shared = page.url();
  expect(shared).toContain('playground=open');
  expect(shared).toContain('#classic-0-serializeparameters');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.goto(shared);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Request URL', { exact: true })).toContainText(
    '/serialization/',
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: '.doctopus/classic-endpoints-expanded-light.png',
  });
  await row.locator('summary').first().click();
  await expect(page.locator('.endpoint-disclosure[open]')).toHaveCount(0);
});

test('large classic lists paginate beyond sidebar limits and remain contained on mobile', async ({
  page,
}) => {
  await page.route(root + '/api-index/0/catalog.json', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        apiId: 'gallery',
        version: 'v1',
        total: 101,
        pageSize: 100,
        pages: 2,
      },
    }),
  );
  const first = Array.from({ length: 100 }, (_, index) => ({
    slug: `virtual${index}`,
    method: 'get',
    path: index === 0 ? '/' + 'long-segment-'.repeat(40) : `/virtual/${index}`,
    summary: `Virtual endpoint ${index}`,
    tag: 'Large API',
    deprecated: false,
  }));
  await page.route(root + '/api-index/0/0.json', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        apiId: 'gallery',
        version: 'v1',
        page: 0,
        operations: first,
      },
    }),
  );
  await page.route(root + '/api-index/0/1.json', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        apiId: 'gallery',
        version: 'v1',
        page: 1,
        operations: [
          {
            slug: 'health',
            method: 'get',
            path: '/health',
            summary: 'Service health',
            tag: 'Large API',
            deprecated: false,
          },
        ],
      },
    }),
  );
  await classic(page);
  await expect(page.locator('.endpoint-disclosure')).toHaveCount(100);
  await expect(page.locator('.classic-pagination')).toContainText(
    '101 endpoints',
  );
  await page
    .getByRole('button', { name: 'Next endpoints', exact: true })
    .click();
  await expect(page.locator('.endpoint-disclosure')).toHaveCount(1);
  await expect(page.locator('.classic-pagination')).toContainText(
    'Page 2 of 2',
  );
  await page.locator('#classic-1-health > summary').click();
  await expect(
    page
      .locator('#classic-1-health')
      .getByRole('heading', { name: 'Response', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Previous endpoints', exact: true })
    .click();
  await expect(page.locator('.endpoint-disclosure')).toHaveCount(100);
  await expect(page.locator('.endpoint-disclosure[open]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '.doctopus/classic-endpoints-mobile-dark.png',
  });
});

test('classic catalog/details recover explicitly and an abandoned detail response cannot replace another endpoint', async ({
  page,
}) => {
  let catalogCalls = 0,
    detailCalls = 0;
  await page.route(root + '/api-index/0/catalog.json', (route) =>
    ++catalogCalls === 1
      ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.continue(),
  );
  await page.goto(root + '/api/gallery/v1/health/');
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await page
    .getByRole('dialog', { name: 'Reader settings', exact: true })
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('classic');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alert')).toContainText(
    'endpoint list could not be loaded',
  );
  await page.getByRole('button', { name: 'Retry endpoint list' }).click();
  await expect(page.locator('.endpoint-disclosure').first()).toBeVisible();
  await page.route(
    root + '/api/gallery/v1/serializeparameters/page-data.json',
    (route) =>
      ++detailCalls === 1
        ? route.fulfill({ status: 503, body: 'Unavailable' })
        : route.continue(),
  );
  const row = page.locator('#classic-0-serializeparameters');
  await row.locator('summary').first().click();
  await expect(row.getByRole('alert')).toContainText(
    'Endpoint details could not be loaded',
  );
  await row.getByRole('button', { name: 'Retry endpoint details' }).click();
  await expect(
    row.getByRole('heading', { name: 'Query parameters', exact: true }),
  ).toBeVisible();
  await row.locator('summary').first().click();
  await page.unroute(
    root + '/api/gallery/v1/serializeparameters/page-data.json',
  );
  const requested = deferred(),
    release = deferred();
  await page.route(
    root + '/api/gallery/v1/serializeparameters/page-data.json',
    async (route) => {
      requested.resolve();
      await release.promise;
      try {
        await route.continue();
      } catch {
        /* The reader canceled this metadata request. */
      }
    },
  );
  try {
    await row.locator('summary').first().click();
    await requested.promise;
    const health = page.locator('#classic-0-health');
    await health.locator('summary').first().click();
    await expect(
      health.getByRole('heading', { name: 'Response', exact: true }),
    ).toBeVisible();
    release.resolve();
    await expect(row).not.toHaveAttribute('open', '');
    await expect(
      health.getByRole('heading', { name: 'Query parameters', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.endpoint-disclosure[open]')).toHaveCount(1);
  } finally {
    release.resolve();
  }
});

test('classic section navigation retains guides and restores endpoint navigation when switching to modern', async ({
  page,
}) => {
  await classic(page);
  const sections = page.getByRole('navigation', {
    name: 'Documentation sections',
  });
  await expect(
    sections.getByRole('button', { name: 'All', exact: true }),
  ).toHaveCount(0);
  await expect(sections.getByRole('button')).toHaveText([
    'API Reference',
    'Documentation',
  ]);
  await expect(
    sections.getByRole('button', { name: 'API Reference', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(
    sections.getByRole('button', { name: 'API Reference', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await sections
    .getByRole('button', { name: 'Documentation', exact: true })
    .click();
  await expect(page).toHaveURL(/\/guides\//);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.sidebar .nav-group a').first()).toBeVisible();
  await expect(page.locator('.sidebar .endpoint-link')).toHaveCount(0);
  await expect(page.locator('.classic-reference')).toHaveCount(0);
  await page.reload();
  await expect(
    sections.getByRole('button', { name: 'Documentation', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    sections.getByRole('button', { name: 'All', exact: true }),
  ).toHaveCount(0);

  await sections
    .getByRole('button', { name: 'API Reference', exact: true })
    .click();
  await expect(page.locator('.endpoint-disclosure').first()).toBeVisible();
  await expect(page.locator('.endpoint-disclosure[open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.endpoint-disclosure').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Toggle navigation' }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await page
    .getByRole('dialog', { name: 'Reader settings', exact: true })
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('modern');
  await page.keyboard.press('Escape');
  await expect(page.locator('.classic-reference')).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.locator('.sidebar .endpoint-link').first()).toBeVisible();
  await expect(
    page.locator('.sidebar .nav-group a:not(.endpoint-link)'),
  ).toHaveCount(0);
});

test('closed endpoint actions align descriptions and open the correct playground without expanding details', async ({
  page,
}) => {
  await classic(page);
  const descriptions = await page
    .locator('.endpoint-disclosure .endpoint-summary')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().left),
    );
  expect(
    Math.max(...descriptions) - Math.min(...descriptions),
  ).toBeLessThanOrEqual(1);
  const row = page.locator('#classic-0-serializeparameters');
  const action = row
    .locator('..')
    .getByRole('button', { name: 'Try now', exact: true });
  await action.focus();
  await action.press('Enter');
  const dialog = page.getByLabel('API playground');
  await expect(dialog).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(page.locator('.endpoint-disclosure[open]')).toHaveCount(0);
  await expect(dialog.getByLabel('Request URL', { exact: true })).toContainText(
    '/serialization/',
  );
  await dialog
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const response = page.waitForResponse(
    (item) =>
      item.url().includes('/v1/serialization/') &&
      item.request().method() === 'GET',
  );
  await dialog.getByRole('button', { name: 'Send request' }).click();
  expect((await response).status()).toBe(200);
  await page.keyboard.press('Escape');
  await expect(action).toBeFocused();
  await expect(page.locator('.endpoint-disclosure[open]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('closed endpoint actions recover from metadata errors and discard results after leaving the reference', async ({
  page,
}) => {
  let attempt = 0;
  const pending = deferred(),
    settled = deferred();
  await page.route('**/serializeparameters/page-data.json', async (route) => {
    attempt++;
    if (attempt === 1)
      return route.fulfill({ status: 503, body: 'Unavailable' });
    if (attempt === 3) {
      await pending.promise;
      await route.continue().catch(() => {});
      settled.resolve();
      return;
    }
    await route.continue();
  });
  await classic(page);
  const row = page.locator('#classic-0-serializeparameters');
  const parent = row.locator('..');
  const action = parent.getByRole('button', { name: 'Try now', exact: true });
  await action.click();
  await expect(parent.getByRole('alert')).toContainText('Endpoint details');
  await expect(row).not.toHaveAttribute('open', '');
  await parent
    .getByRole('button', { name: 'Retry endpoint details', exact: true })
    .click();
  await expect(page.getByLabel('API playground')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(action).toBeFocused();
  await action.click();
  await expect(action).toHaveAttribute('aria-busy', 'true');
  await page
    .getByRole('navigation', { name: 'Documentation sections' })
    .getByRole('button', { name: 'Documentation', exact: true })
    .click();
  await expect(page).toHaveURL(/\/guides\//);
  pending.resolve();
  await settled.promise;
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('API playground')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('playground')).toBe(false);
});

test('endpoint Try now stays in its header in both disclosure states at every layout width', async ({
  page,
}) => {
  await classic(page);
  const row = page.locator('#classic-0-serializeparameters');
  const button = row
    .locator('..')
    .getByRole('button', { name: 'Try now', exact: true });
  for (const width of [1850, 855, 360]) {
    await page.setViewportSize({ width, height: 908 });
    for (const open of [false, true]) {
      if (
        (await row.evaluate((el) => (el as HTMLDetailsElement).open)) !== open
      )
        await row.locator(':scope > summary').click();
      await expect(row).toHaveJSProperty('open', open);
      const bounds = await button.evaluate((el) => {
        const action = el.getBoundingClientRect();
        const header = el
          .parentElement!.querySelector('summary')!
          .getBoundingClientRect();
        return {
          top: action.top - header.top,
          bottom: header.bottom - action.bottom,
          left: action.left - header.left,
          right: header.right - action.right,
        };
      });
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeGreaterThanOrEqual(0);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeGreaterThanOrEqual(0);
      await expect(button).toBeEnabled();
    }
    await row.locator(':scope > summary').click();
  }
});
