import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const pageUrl =
  'http://127.0.0.1:4174/gallery/api/gallery/v1/previewmockresponses/?playground=open';
const endpoint = 'http://127.0.0.1:4174/api/projects/gallery/relay';
const capabilities = {
  schemaVersion: 1,
  project: 'gallery',
  maxRequestBytes: 1024 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
  timeoutMs: 30_000,
  requestHeaders: ['Accept', 'Authorization', 'Content-Type'],
  destinations: [
    {
      origin: 'https://api.example.test',
      pathPrefix: '/',
      methods: ['GET', 'POST'],
    },
  ],
};
test('relay is an explicit choice and preserves URL, confirmation, response folding and complete copy', async ({
  page,
}) => {
  let checks = 0,
    posts = 0,
    direct = 0;
  const raw = '{"relayed":true,"nested":{"number":9007199254740993}}\n';
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
  await page.route('https://api.example.test/**', async (route) => {
    direct++;
    await route.abort();
  });
  await page.route(endpoint, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      checks++;
      expect(request.headers().authorization).toBeUndefined();
      return route.fulfill({ json: capabilities });
    }
    posts++;
    expect(request.headers().authorization).toBeUndefined();
    const data = request.postDataJSON();
    expect(data.url).toBe('https://api.example.test/mock-preview');
    expect(data.headers).toContainEqual([
      'authorization',
      'Bearer relay-secret',
    ]);
    await route.fulfill({
      json: {
        schemaVersion: 1,
        status: 201,
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from(raw).toString('base64'),
      },
    });
  });
  await page.goto(pageUrl);
  const playground = page.getByLabel('API playground');
  await expect(playground).toBeVisible();
  if (await playground.getByLabel('bearer credential', { exact: true }).count())
    await playground
      .getByLabel('bearer credential', { exact: true })
      .fill('demo-token');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('relay-secret');
  expect(checks).toBe(0);
  expect(posts).toBe(0);
  await expect(playground.getByLabel('Request transport')).toHaveValue(
    'browser',
  );
  await playground.getByLabel('Request transport').selectOption('relay');
  await expect(
    playground.getByText(
      'Your API credentials and request payload pass through this documentation server.',
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  expect(checks).toBe(1);
  expect(posts).toBe(0);
  await expect(
    playground.getByLabel('Request URL', { exact: true }),
  ).toHaveText('https://api.example.test/mock-preview');
  await playground.getByRole('button', { name: 'Copy request URL' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe('https://api.example.test/mock-preview');
  page.once('dialog', (dialog) => dialog.dismiss());
  await playground.getByRole('button', { name: 'Send request' }).click();
  expect(posts).toBe(0);
  page.once('dialog', (dialog) => dialog.accept());
  await playground.getByRole('button', { name: 'Send request' }).click();
  const output = playground.getByRole('region', { name: 'API response' });
  await expect(output.locator('.response-meta')).toContainText('201');
  await expect(output.locator('.monaco-editor .view-lines')).toContainText(
    '9007199254740993',
  );
  await output
    .getByRole('button', { name: 'Collapse all', exact: true })
    .click();
  await output.getByRole('button', { name: 'Copy entire response' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe(raw);
  expect(posts).toBe(1);
  expect(direct).toBe(0);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await page.getByRole('button', { name: 'Try now', exact: true }).click();
      await playground.getByLabel('Request transport').selectOption('relay');
      await playground
        .getByLabel('bearer credential', { exact: true })
        .fill('relay-secret');
      await expect(
        playground.getByRole('button', { name: 'Send request' }),
      ).toBeEnabled();
    }
    expect(
      (await new AxeBuilder({ page }).include('.playground-dialog').analyze())
        .violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator('.playground-dialog')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  await expect(playground.getByLabel('Request transport')).toHaveValue(
    'browser',
  );
  expect(checks).toBe(2);
});
test('relay denial blocks Send, supports an explicit access recheck and returns to direct sending', async ({
  page,
}) => {
  let checks = 0;
  await page.route(endpoint, async (route) => {
    checks++;
    await route.fulfill(
      checks === 1
        ? { status: 401, body: 'private detail' }
        : { json: capabilities },
    );
  });
  await page.goto(pageUrl);
  const playground = page.getByLabel('API playground');
  await expect(playground).toBeVisible();
  if (await playground.getByLabel('bearer credential', { exact: true }).count())
    await playground
      .getByLabel('bearer credential', { exact: true })
      .fill('demo-token');
  await playground.getByLabel('Request transport').selectOption('relay');
  await expect(playground.getByRole('alert')).toHaveText(
    /Sign in to the documentation server/,
  );
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await expect(playground).not.toContainText('private detail');
  await playground
    .getByRole('button', { name: 'Check relay access again' })
    .click();
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  expect(checks).toBe(2);
  await playground.getByLabel('Request transport').selectOption('browser');
  await expect(playground).toContainText(
    'Requests are sent directly from your browser.',
  );
  await expect(playground.locator('.relay-notice')).toHaveCount(0);
});
test('closing the modal cancels a pending relay exchange without an automatic retry', async ({
  page,
}) => {
  let posts = 0,
    release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(endpoint, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: capabilities });
    posts++;
    await held;
    await route.abort().catch(() => {});
  });
  await page.goto(pageUrl);
  const playground = page.getByLabel('API playground');
  await expect(playground).toBeVisible();
  if (await playground.getByLabel('bearer credential', { exact: true }).count())
    await playground
      .getByLabel('bearer credential', { exact: true })
      .fill('demo-token');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('relay-secret');
  await playground.getByLabel('Request transport').selectOption('relay');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  page.once('dialog', (dialog) => dialog.accept());
  await playground.getByRole('button', { name: 'Send request' }).click();
  await expect.poll(() => posts).toBe(1);
  const failed = page.waitForEvent(
    'requestfailed',
    (request) => request.url() === endpoint,
  );
  await page.keyboard.press('Escape');
  expect((await failed).failure()?.errorText).toMatch(
    /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i,
  );
  release();
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  await expect(playground.getByLabel('Request transport')).toHaveValue(
    'browser',
  );
  await expect(
    playground.getByText('Your response will appear here', { exact: true }),
  ).toBeVisible();
  expect(posts).toBe(1);
});
