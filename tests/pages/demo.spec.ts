import { changePublishedServer } from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const errors: string[] = [];
  failures.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      errors.push('External request: ' + request.url());
  });
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
});
test.afterEach(async ({ page }) => expect(failures.get(page)).toEqual([]));

test('static demo renders guides and direct endpoint links without backend or SPA fallback', async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto('./');
  await expect(page.locator('.brand')).toContainText('Doctopus');
  const stylesheet = page.locator('link[rel="stylesheet"]').first();
  const css = await request.get(
    new URL((await stylesheet.getAttribute('href'))!, baseURL).href,
  );
  expect(css.status()).toBe(200);
  expect(css.headers()['content-type']).toContain('text/css');
  const mascot = page.locator('.brand img');
  await expect(mascot).toHaveAttribute(
    'src',
    /\/assets\/doctopus-mascot\.webp$/,
  );
  await expect
    .poll(() =>
      mascot.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(192);
  const favicon = page.locator('link[rel="icon"]');
  await expect(favicon).toHaveAttribute(
    'href',
    /\/assets\/doctopus-icon\.svg$/,
  );
  expect(
    (
      await request.get(
        new URL((await favicon.getAttribute('href'))!, baseURL).href,
      )
    ).status(),
  ).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Welcome to Doctopus', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.guide-content')).toContainText('No API server');
  await page.goto('api/orbit/v1/list-projects/');
  await expect(
    page.getByRole('heading', { name: 'List projects', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Try now', exact: true }),
  ).toBeVisible();
  expect((await request.get(baseURL + 'does-not-exist/')).status()).toBe(404);
  expect(
    (await request.get(baseURL + 'api/projects/not-a-backend')).status(),
  ).toBe(404);
});

test('Send mock stays local after published server changes and supports highlighted, folded fullscreen copying', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('demo-copy', text);
        },
      },
    }),
  );
  await page.goto('api/orbit/v1/list-projects/?playground=open');
  const playground = page.getByLabel('API playground');
  await expect(playground).toContainText('No API requests are sent');
  await expect(playground.locator('.auth-fields')).toHaveCount(1);
  await expect(
    playground.getByLabel('bearerAuth credential', { exact: true }),
  ).toBeVisible();
  await expect(playground.locator('.relay-controls')).toHaveCount(0);
  await changePublishedServer(
    page,
    playground,
    'https://example.com/never-call-this',
  );
  await playground
    .getByRole('button', { name: 'Send mock request', exact: true })
    .click();
  await expect(playground.locator('.response-meta')).toContainText('200');
  await expect(playground.locator('.mock-response-badge')).toContainText(
    'example',
  );
  await expect(playground.locator('.monaco-editor .view-lines')).toContainText(
    'Aurora',
  );
  await playground
    .getByRole('button', { name: 'Collapse all', exact: true })
    .click();
  await expect(
    playground.locator('.codicon-folding-collapsed').first(),
  ).toBeVisible();
  await playground
    .getByRole('button', { name: 'View response fullscreen' })
    .click();
  const fullscreen = page.getByRole('dialog', {
    name: 'Response body',
    exact: true,
  });
  await expect(
    fullscreen.locator('.monaco-editor textarea').first(),
  ).toHaveJSProperty('readOnly', true);
  await fullscreen
    .getByRole('button', { name: 'Copy entire response', exact: true })
    .click();
  const body = await page.evaluate(() => sessionStorage.getItem('demo-copy'));
  expect(
    JSON.parse(body!).data.map((project: { id: string }) => project.id),
  ).toEqual(['proj_aurora', 'proj_horizon']);
  await page.keyboard.press('Escape');
  await playground.getByText('Mock response options', { exact: true }).click();
  await playground
    .getByLabel('Mock response status', { exact: true })
    .selectOption('401');
  await playground
    .getByRole('button', { name: 'Generate mock response', exact: true })
    .click();
  await expect(playground.locator('.response-meta')).toContainText('401');
  await expect(playground.locator('.monaco-editor .view-lines')).toContainText(
    'unauthorized',
  );
});

test('POST, DELETE and classic playgrounds remain mock-only with no live confirmation', async ({
  page,
}) => {
  let confirmations = 0;
  page.on('dialog', (dialog) => {
    confirmations++;
    void dialog.dismiss();
  });
  await page.goto('api/orbit/v1/create-project/?playground=open');
  await page
    .getByRole('button', { name: 'Send mock request', exact: true })
    .click();
  await expect(page.locator('.response-meta')).toContainText('201');
  await expect(page.locator('.monaco-editor .view-lines')).toContainText(
    'proj_aurora',
  );
  await page.goto('api/orbit/v1/delete-project/?playground=open');
  await page
    .getByRole('button', { name: 'Send mock request', exact: true })
    .click();
  await expect(page.locator('.response-meta')).toContainText('204');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await page
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('classic');
  await page.keyboard.press('Escape');
  const list = page.getByRole('region', { name: 'API endpoint reference' });
  await expect(list.locator('.endpoint-disclosure')).toHaveCount(5);
  const row = list.locator('#classic-0-list-projects');
  await row.locator('summary').click();
  await row
    .locator('..')
    .getByRole('button', { name: 'Try now', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Send mock request', exact: true })
    .click();
  await expect(page.locator('.response-meta')).toContainText('200');
  expect(confirmations).toBe(0);
});

test('demo search, presets and mobile playground remain accessible', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Search documentation' }).click();
  const search = page.getByRole('dialog', { name: 'Search documentation' });
  await search
    .getByRole('textbox', { name: 'Search documentation', exact: true })
    .fill('webhook');
  await expect(
    search.getByRole('link').filter({ hasText: 'Create a webhook' }).first(),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await page
    .getByRole('combobox', { name: 'Preset', exact: true })
    .selectOption('ocean');
  await page
    .getByRole('combobox', { name: 'Appearance mode', exact: true })
    .selectOption('dark');
  await page.keyboard.press('Escape');
  await page.goto('api/orbit/v1/list-projects/?playground=open');
  await page
    .getByRole('button', { name: 'Send mock request', exact: true })
    .click();
  await expect(page.locator('.monaco-editor')).toHaveCSS(
    'background-color',
    'rgb(9, 13, 13)',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: '.doctopus/pages-screenshots/playground-mobile.png',
    fullPage: true,
  });
});

test('documentation and deep endpoint pages remain readable without JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(baseURL! + 'guides/quickstart/');
    await expect(
      page.getByRole('heading', { name: 'Playground tour', exact: true }),
    ).toBeVisible();
    await page.goto(baseURL! + 'guides/installation/setup/');
    await expect(
      page.getByRole('heading', {
        name: 'Installation and usage',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('.guide-content')).toContainText(
      'pnpm install --frozen-lockfile',
    );
    await page.goto(baseURL! + 'guides/integrations/get-started/');
    await expect(
      page.getByRole('heading', {
        name: 'Add to your application',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('.guide-content')).toContainText(
      'doctopus.url=/openapi.yaml',
    );
    await expect(page.locator('.guide-content')).toContainText(
      'createExpressDocs',
    );
    await page.goto(baseURL! + 'api/orbit/v1/list-projects/');
    await expect(
      page.getByRole('heading', { name: 'List projects', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText(
          'Browse projects in a workspace with cursor-based pagination.',
        )
        .first(),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('handbook groups support setup navigation, local fragments, search and mobile reading', async ({
  page,
  request,
}) => {
  await page.goto('./');
  await page
    .getByRole('button', { name: 'Documentation', exact: true })
    .click();
  const sidebar = page.getByLabel('Documentation navigation', { exact: true });
  await expect(sidebar.getByRole('navigation')).toHaveCount(6);
  for (const group of [
    'Get started',
    'Installation',
    'Integrations',
    'Authoring',
    'Playground',
    'Operations',
  ]) {
    await expect(
      sidebar.getByRole('navigation', { name: group, exact: true }),
    ).toHaveCount(1);
  }
  await sidebar
    .getByRole('link', { name: 'Install Doctopus', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Install Doctopus', exact: true }),
  ).toBeVisible();
  await page
    .locator('.guide-content')
    .getByRole('link', {
      name: 'Add the starter and configure your OpenAPI URL',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(
    /\/guides\/integrations\/get-started\/#heading-spring-boot$/,
  );
  await expect(page.locator('#heading-spring-boot')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Add to your application', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.guide-content')).toContainText('/v3/api-docs');
  const docs = await (await request.get('site.json')).json();
  expect(docs.guides.length).toBeGreaterThan(20);
  for (const guide of docs.guides) {
    expect((await request.get(`guides/${guide.slug}/`)).status()).toBe(200);
  }
  await page
    .getByRole('button', { name: 'Search documentation', exact: true })
    .click();
  const search = page.getByRole('dialog', {
    name: 'Search documentation',
    exact: true,
  });
  await search
    .getByRole('textbox', { name: 'Search documentation', exact: true })
    .fill('offline installation');
  await search
    .getByRole('link')
    .filter({ hasText: 'Offline installations' })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Offline installations', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('site root selects API Reference for classic and All for modern', async ({
  page,
}) => {
  await page.goto('');
  await page
    .getByRole('button', { name: 'Open reader settings', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('classic');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('region', { name: 'API endpoint reference' }),
  ).toBeVisible();
  await page.goto('');
  const tabs = page.getByRole('navigation', { name: 'Documentation sections' });
  await expect(
    tabs.getByRole('button', { name: 'API Reference', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('region', { name: 'API endpoint reference' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Open reader settings', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('modern');
  await page.keyboard.press('Escape');
  await page.goto('');
  await expect(
    tabs.getByRole('button', { name: 'All', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('heading', { name: 'Welcome to Doctopus', exact: true }),
  ).toBeVisible();
});
