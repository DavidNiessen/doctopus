import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const root = 'http://127.0.0.1:4177/localized';
test('translated labels preserve search, theme, modal focus, Scalar URL copying and Monaco controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    }),
  );
  await page.goto(root + '/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(
    page.getByRole('button', { name: 'Dokumentation', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Dokumentation durchsuchen', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Dokumentation durchsuchen', exact: true })
    .fill('Projekte');
  await expect(page.locator('.search-results')).toContainText(
    'Projekte auflisten',
  );
  await page
    .getByRole('button', { name: 'Suche schließen', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Zum dunklen Design wechseln' })
    .click();
  await page.getByRole('button', { name: 'API-Referenz', exact: true }).click();
  await page.getByRole('button', { name: 'Jetzt testen', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Projekte auflisten testen',
  });
  const close = dialog.getByRole('button', { name: 'Testfenster schließen' });
  await expect(close).toBeFocused();
  const playground = page.getByLabel('API testen', { exact: true });
  await expect(
    playground.getByText('Deine Antwort erscheint hier', { exact: true }),
  ).toBeVisible();
  await playground
    .getByRole('button', { name: 'Anfrage-URL kopieren' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe('http://127.0.0.1:4010/v1/projects');
  await expect(
    playground.getByRole('status').filter({ hasText: 'Kopiert' }),
  ).toHaveCount(1);
  await playground
    .getByLabel('Zugangsdaten bearer', { exact: true })
    .fill('demo-token');
  await playground.getByRole('button', { name: 'Anfrage senden' }).click();
  const output = playground.getByRole('region', { name: 'API-Antwort' });
  await expect(output.locator('.monaco-editor')).toBeVisible();
  await output.getByRole('button', { name: 'Alles einklappen' }).click();
  await output
    .getByRole('button', { name: 'Vollständige Antwort kopieren' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toContain('data');
  await output.getByRole('button', { name: 'Alles ausklappen' }).click();
  expect(
    (await new AxeBuilder({ page }).include('.playground-dialog').analyze())
      .violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Jetzt testen', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Jetzt testen', exact: true }).click();
  await expect(close).toBeFocused();
  await close.click();
  expect(errors).toEqual([]);
});
test('translated navigation is prerendered and readable without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(root + '/');
    await expect(
      page.getByRole('link', { name: 'Dokumentation', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Einstieg', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Erstellt mit doctopus', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'API-Referenz', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Projekte auflisten', exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test('locale links keep source pages, clear playground credentials and preserve prefixed SPA/search navigation', async ({
  page,
}) => {
  const errors: string[] = [],
    searchRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      request.url().includes('search-manifest') ||
      request.url().endsWith('/catalog.json')
    )
      searchRequests.push(request.url());
  });
  await page.goto(
    root + '/api/api/v1/listprojects/?private=not-for-links#responses',
  );
  await page.getByRole('button', { name: 'Jetzt testen', exact: true }).click();
  const modal = page.getByLabel('API testen', { exact: true });
  await modal
    .getByLabel('Zugangsdaten bearer', { exact: true })
    .fill('unshared-secret');
  await modal.getByLabel('Für 30 Minuten in diesem Tab merken').check();
  await page.keyboard.press('Escape');
  await page.locator('.locale-menu > summary').click();
  const english = page
    .locator('.locale-menu')
    .getByRole('link', { name: 'English', exact: true });
  await expect(english).toHaveAttribute(
    'href',
    '/localized/en/api/api/v1/listprojects/',
  );
  await english.click();
  await expect(page).toHaveURL(root + '/en/api/api/v1/listprojects/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('note')).toHaveText(
    'Documentation content is shown in Deutsch. UI language: English.',
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://docs.example.test/localized/api/api/v1/listprojects/',
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex,follow',
  );
  await expect(
    page.getByRole('button', { name: 'Forget saved API credentials' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  await expect(
    page
      .getByLabel('API playground')
      .getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Documentation', exact: true })
    .click();
  await expect(page).toHaveURL(root + '/en/guides/introduction/');
  await expect(
    page.getByRole('heading', { name: 'Getting started', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.guide-content').locator('..')).toHaveAttribute(
    'lang',
    'en',
  );
  await page
    .getByRole('button', { name: 'Search documentation', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Search documentation', exact: true })
    .fill('Projekte');
  await page
    .locator('.search-results')
    .getByRole('link')
    .filter({ hasText: 'Projekte auflisten' })
    .click();
  await expect(page).toHaveURL(root + '/en/api/api/v1/listprojects/');
  expect(searchRequests).toEqual([root + '/search/en/catalog.json']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.locale-menu > summary').click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});
test('alternate locales and their language menu work without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(root + '/en/guides/authentication/');
    await expect(
      page.getByRole('link', { name: 'Documentation', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('note')).toContainText('Deutsch');
    await page.locator('.locale-menu > summary').click();
    await page
      .locator('.locale-menu')
      .getByRole('link', { name: 'Deutsch', exact: true })
      .click();
    await expect(page).toHaveURL(root + '/guides/authentication/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('note')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
test('unknown locale paths retain the verified default-language 404 without hydration errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  expect((await page.goto(root + '/en/not-a-page/'))?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(
    page.getByRole('heading', { name: 'Page not found', exact: true }),
  ).toBeVisible();
  await page.locator('.locale-menu > summary').click();
  await expect(
    page
      .locator('.locale-menu')
      .getByRole('link', { name: 'English', exact: true }),
  ).toHaveAttribute('href', '/localized/en/');
  expect(errors).toEqual([]);
});
test('authored guide translations update prose, search and reciprocal SEO metadata while untranslated pages retain fallback', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(root + '/en/guides/introduction/');
  await expect(
    page.getByRole('heading', { name: 'Getting started', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.guide-content')).toContainText(
    'Launch your rocket',
  );
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://docs.example.test/localized/en/guides/introduction/',
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'index,follow',
  );
  await expect(page.locator('link[data-doc-locale]')).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Search documentation', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Search documentation', exact: true })
    .fill('rocket');
  await expect(page.locator('.search-results')).toContainText(
    'Getting started',
  );
  await page
    .locator('.search-results')
    .getByRole('link')
    .filter({ hasText: 'Getting started' })
    .click();
  await expect(page).toHaveURL(root + '/en/guides/introduction/');
  await page
    .locator('.sidebar')
    .getByRole('link', { name: 'Authentifizierung', exact: true })
    .click();
  await expect(page).toHaveURL(root + '/en/guides/authentication/');
  await expect(page.getByRole('note')).toContainText(
    'Documentation content is shown in Deutsch',
  );
  await expect(page.locator('link[data-doc-locale]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://docs.example.test/localized/guides/authentication/',
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex,follow',
  );
  await page
    .locator('.sidebar')
    .getByRole('link', { name: 'Getting started', exact: true })
    .click();
  await expect(page.locator('link[data-doc-locale]')).toHaveCount(2);
  await page.locator('.locale-menu > summary').click();
  await expect(page.locator('.locale-menu')).toContainText(
    'Page content: English',
  );
  await page
    .locator('.locale-menu')
    .getByRole('link', { name: 'Deutsch', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Einstieg', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.guide-content')).toContainText(
    'Projekte erkunden',
  );
  await expect(page.locator('link[data-doc-locale]')).toHaveCount(2);
  expect(errors).toEqual([]);
});
test('localized search rejects other locale and traversal shards, then recovers on an explicit reopen', async ({
  page,
}) => {
  let manifests = 0;
  const shards: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes('/search/') && /\/\d+\.json$/.test(path))
      shards.push(path);
  });
  await page.route(root + '/search/en/catalog.json', async (route) => {
    manifests++;
    if (manifests === 1)
      return route.fulfill({
        json: {
          schemaVersion: 1,
          shards: [
            'search/de/0.json',
            'search/en/../0.json',
            'search/en/0.json?key=not-a-shard',
          ],
        },
      });
    await route.continue();
  });
  await page.goto(root + '/en/guides/introduction/');
  const open = page.getByRole('button', {
    name: 'Search documentation',
    exact: true,
  });
  await open.click();
  await page
    .getByRole('textbox', { name: 'Search documentation', exact: true })
    .fill('rocket');
  await expect.poll(() => manifests).toBe(1);
  await expect(page.locator('.search-filters [role="status"]')).toHaveCount(0);
  expect(shards).toEqual([]);
  await page.getByRole('button', { name: 'Close search', exact: true }).click();
  await open.click();
  await expect(page.locator('.search-results')).toContainText(
    'Getting started',
  );
  expect(manifests).toBe(2);
  expect(shards).toEqual(['/localized/search/en/0.json']);
});
