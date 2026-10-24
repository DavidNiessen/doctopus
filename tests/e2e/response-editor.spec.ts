import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const route =
  'http://127.0.0.1:4174/gallery/api/gallery/v1/serializeparameters/';
const raw =
  '{"id":9007199254740993,"profile":{"name":"Ada","roles":["reader","writer"],"nested":{"precise":1.234567890123456789}},"message":"Hello 🌍"}\n';
async function clipboard(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    });
  });
}

test('response-only Monaco highlights and folds read-only JSON while copying the entire original response', async ({
  page,
}) => {
  const failures: string[] = [],
    external: string[] = [],
    assets: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname))
      external.push(url.href);
    if (/ResponseEditor|editor\.api|jsonMode|\.worker-/.test(url.pathname))
      assets.push(url.pathname);
  });
  await clipboard(page);
  await page.route('http://127.0.0.1:4010/v1/serialization/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization',
        'access-control-allow-methods': 'GET, OPTIONS',
      },
      body: raw,
    }),
  );
  await page.goto(route + '?playground=open');
  const playground = page.getByLabel('API playground'),
    output = playground.getByRole('region', { name: 'API response' });
  await expect(
    output.getByText('Your response will appear here', { exact: true }),
  ).toBeVisible();
  await expect(
    output.getByRole('button', { name: 'Request', exact: true }),
  ).toHaveCount(0);
  expect(assets).toEqual([]);
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground.getByRole('button', { name: 'Send request' }).click();
  const editor = output.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  const lines = editor.locator('.view-lines');
  await expect(lines).toContainText('9007199254740993');
  await expect(lines).toContainText('1.234567890123456789');
  await expect(editor.locator('textarea').first()).toHaveJSProperty(
    'readOnly',
    true,
  );
  expect(
    await lines
      .locator('[class*="mtk"]')
      .evaluateAll(
        (nodes) =>
          new Set(nodes.map((node) => getComputedStyle(node).color)).size,
      ),
  ).toBeGreaterThan(1);
  await output
    .getByRole('button', { name: 'Collapse all', exact: true })
    .click();
  await expect(
    editor.locator('.codicon-folding-collapsed').first(),
  ).toBeVisible();
  await expect(lines).not.toContainText('Ada');
  await output
    .getByRole('button', { name: 'View response fullscreen' })
    .click();
  const fullscreen = page.getByRole('dialog', {
    name: 'Response body',
    exact: true,
  });
  await expect(fullscreen).toBeVisible();
  await expect(fullscreen.locator('.monaco-editor')).toBeVisible();
  const expandedBounds = await fullscreen.boundingBox();
  expect(expandedBounds!.width).toBeGreaterThan(
    page.viewportSize()!.width - 40,
  );
  expect(expandedBounds!.height).toBeGreaterThan(
    page.viewportSize()!.height - 40,
  );
  await expect(
    fullscreen.locator('.codicon-folding-collapsed').first(),
  ).toBeVisible();
  await fullscreen
    .getByRole('button', { name: 'Copy entire response' })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe(raw);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: '.doctopus/response-fullscreen-light.png' });
  await page.keyboard.press('Escape');
  await expect(fullscreen).not.toBeVisible();
  await expect(playground).toBeVisible();
  await expect(
    output.getByRole('button', { name: 'View response fullscreen' }),
  ).toBeFocused();
  await expect(
    editor.locator('.codicon-folding-collapsed').first(),
  ).toBeVisible();
  await output.getByRole('button', { name: 'Copy entire response' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe(raw);
  await output.getByRole('button', { name: 'Expand all', exact: true }).click();
  await expect(lines).toContainText('Ada');
  await editor.click();
  await page.keyboard.type('THIS_MUST_NOT_EDIT_THE_RESPONSE');
  await expect(lines).not.toContainText('THIS_MUST_NOT_EDIT_THE_RESPONSE');
  await output.getByRole('button', { name: 'Copy entire response' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe(raw);
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: '.doctopus/response-editor-light.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.getByRole('button', { name: 'Try this endpoint' }).click();
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground.getByRole('button', { name: 'Send request' }).click();
  await expect(editor).toHaveClass(/vs-dark/);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await output
    .getByRole('button', { name: 'View response fullscreen' })
    .click();
  await expect(fullscreen).toBeVisible();
  await expect(fullscreen.locator('.monaco-editor')).toHaveClass(/vs-dark/);
  expect(
    await fullscreen.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await fullscreen
    .getByRole('button', { name: 'Exit response fullscreen' })
    .click();
  await expect(fullscreen).not.toBeVisible();
  await expect(playground).toBeVisible();
  await editor.scrollIntoViewIfNeeded();
  expect(
    await page
      .locator('.playground-dialog')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: '.doctopus/response-editor-mobile-dark.png' });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some(
          (face) =>
            face.family.replace(/^['"]|['"]$/g, '') === 'codicon' &&
            face.status === 'loaded',
        ),
      ),
    )
    .toBe(true);
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
});

test('the URL bar resolves and copies the same complete host, path and query used by the request', async ({
  page,
}) => {
  await clipboard(page);
  await page.goto(route + '?playground=open');
  const playground = page.getByLabel('API playground');
  const url = playground.getByLabel('Request URL', { exact: true });
  const expected =
    'http://127.0.0.1:4010/v1/serialization/;color=blue;color=black?tags=a%2Cb,c%26d&payload=%22hello%20world%22';
  await expect(url).toHaveText(expected);
  await playground.getByRole('button', { name: 'Copy request URL' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe(expected);
  await playground.getByLabel('payload parameter').fill('"Updated + query"');
  await expect(url).toContainText('payload=%22Updated%20%2B%20query%22');
  await playground
    .getByLabel('API server')
    .fill('http://127.0.0.1:4010/another-base');
  await expect(url).toContainText(
    'http://127.0.0.1:4010/another-base/serialization/',
  );
  await playground.getByRole('button', { name: 'Copy request URL' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe(await url.textContent());
  await playground.getByLabel('API server').fill('invalid-server');
  await expect(
    playground.getByRole('button', { name: 'Copy request URL' }),
  ).toBeDisabled();
});

test('text, HTML, XML and empty responses remain safe, read-only and copyable', async ({
  page,
}) => {
  await clipboard(page);
  let body = '',
    contentType = 'text/plain';
  await page.route('http://127.0.0.1:4010/v1/serialization/**', (route) =>
    route.fulfill({
      status: 200,
      contentType,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization',
        'access-control-allow-methods': 'GET, OPTIONS',
      },
      body,
    }),
  );
  await page.goto(route + '?playground=open');
  const playground = page.getByLabel('API playground'),
    output = playground.getByRole('region', { name: 'API response' });
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  for (const [mime, value, label] of [
    ['text/plain', '  Text response\r\nHello 🌍\n', 'Text'],
    ['application/xml', '<result>\n  <name>Ada</name>\n</result>', 'XML'],
    [
      'text/html',
      '<html><body><script>window.responseExecuted=true</script><p>Text</p></body></html>',
      'HTML',
    ],
    ['text/plain', '', 'Text'],
  ]) {
    body = value!;
    contentType = mime!;
    await playground.getByRole('button', { name: 'Send request' }).click();
    await expect(output.locator('.response-editor-toolbar small')).toHaveText(
      label!,
    );
    await output.getByRole('button', { name: 'Copy entire response' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { copied: string }).copied),
      )
      .toBe(value);
  }
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { responseExecuted?: boolean }).responseExecuted,
    ),
  ).toBeUndefined();
  await expect(
    output.getByText('Your response will appear here', { exact: true }),
  ).toHaveCount(0);
});

test('an unavailable editor chunk preserves the response and full-copy action', async ({
  page,
}) => {
  await clipboard(page);
  await page.route('**/ResponseEditor-*.js', (route) => route.abort());
  await page.goto(route + '?playground=open');
  const playground = page.getByLabel('API playground');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground.getByRole('button', { name: 'Send request' }).click();
  const output = playground.getByRole('region', { name: 'API response' });
  await expect(
    output.getByText(
      'The editor is unavailable. The full response is shown below.',
    ),
  ).toBeVisible();
  const body = await output.locator('.response-fallback').textContent();
  await output.getByRole('button', { name: 'Copy entire response' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe(body);
});
