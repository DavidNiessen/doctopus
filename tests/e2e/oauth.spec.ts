import { openRequestSettings } from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const route = 'http://127.0.0.1:4174/gallery/api/gallery/v1/oauthprojects/';
test('PKCE acquisition binds the popup, sends a real API request and clears expired tokens', async ({
  page,
}) => {
  await page.clock.install();
  const errors: string[] = [],
    exchanges: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url() === 'http://127.0.0.1:4020/token')
      exchanges.push(request.postData() ?? '');
  });
  await page.goto(route);
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const playground = page.getByLabel('API playground');
  await playground.locator('.playground-request-example > summary').click();
  const popupPromise = page.waitForEvent('popup');
  await playground
    .getByRole('button', { name: 'Authorize oauth with PKCE' })
    .click();
  const popup = await popupPromise;
  await popup.waitForURL('http://127.0.0.1:4020/authorize?**');
  const state = new URL(popup.url()).searchParams.get('state')!;
  const forged = new URLSearchParams({ state, code: 'forged-code' }).toString();
  await page.evaluate(
    (query) =>
      window.postMessage(
        { type: 'doctopus:oauth-callback', query },
        location.origin,
      ),
    forged,
  );
  await popup.evaluate(
    (query) =>
      window.opener.postMessage(
        { type: 'doctopus:oauth-callback', query },
        'http://127.0.0.1:4174',
      ),
    forged,
  );
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
  expect(exchanges).toHaveLength(0);
  const closed = popup.waitForEvent('close');
  await popup.getByRole('button', { name: 'Authorize fixture client' }).click();
  await closed;
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('demo-token');
  expect(exchanges).toHaveLength(1);
  const verifier = new URLSearchParams(exchanges[0]).get('code_verifier')!;
  expect(verifier).toHaveLength(43);
  await expect(playground.locator('pre')).toContainText('YOUR_CREDENTIAL');
  await expect(playground.locator('pre')).not.toContainText('demo-token');
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toContain('demo-token');
  expect(storage).not.toContain(verifier);
  const response = page.waitForResponse(
    (result) =>
      result.url() === 'http://127.0.0.1:4010/v1/projects' &&
      result.request().method() === 'GET',
  );
  await playground.getByRole('button', { name: 'Send request' }).click();
  expect((await response).status()).toBe(200);
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('demo-token');
  await page.clock.fastForward(61_000);
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
  await expect(
    playground.locator('.auth-fields').getByRole('status'),
  ).toContainText('Token expired');
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('provider denial, wrong state and cancellation cannot install credentials', async ({
  page,
}) => {
  let exchanges = 0;
  page.on('request', (request) => {
    if (request.url() === 'http://127.0.0.1:4020/token') exchanges++;
  });
  await page.goto(route);
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const playground = page.getByLabel('API playground');
  await playground.locator('.playground-request-example > summary').click();
  const open = async () => {
    const result = page.waitForEvent('popup');
    await playground
      .getByRole('button', { name: 'Authorize oauth with PKCE' })
      .click();
    const popup = await result;
    await popup.waitForURL('http://127.0.0.1:4020/authorize?**');
    return popup;
  };
  const denied = await open();
  await denied.getByRole('button', { name: 'Deny fixture client' }).click();
  await expect(playground.getByRole('alert')).toContainText('denied or failed');
  await expect(page.locator('body')).not.toContainText(
    'sensitive-provider-marker',
  );
  const wrong = await open();
  await wrong.goto(
    'http://127.0.0.1:4174/gallery/oauth/callback/?state=wrong-state&code=forged-code',
    { waitUntil: 'commit' },
  );
  await expect(playground.getByRole('alert')).toContainText('window closed');
  const cancelled = await open();
  const closed = cancelled.waitForEvent('close');
  await playground
    .getByRole('button', { name: 'Cancel oauth authorization' })
    .click();
  await closed;
  await expect(playground.getByRole('alert')).toHaveText(
    'Authorization cancelled.',
  );
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
  expect(exchanges).toBe(0);
  await playground
    .getByLabel('oauth credential', { exact: true })
    .fill('fixture-manual-token');
  await openRequestSettings(playground);
  await playground
    .getByLabel('API server', { exact: true })
    .fill('http://127.0.0.1:4010/v2');
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
});

test('navigation cancels pending authorization and standalone callbacks scrub URL data', async ({
  page,
}) => {
  await page.goto(route);
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const result = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Authorize oauth with PKCE' }).click();
  const popup = await result;
  await popup.waitForURL('http://127.0.0.1:4020/authorize?**');
  const closed = popup.waitForEvent('close');
  await page.getByRole('button', { name: 'Close playground' }).click();
  await page.getByRole('link', { name: /Service health/ }).click();
  await closed;
  await page.goto(route);
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  await expect(
    page.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
  await page.goto(
    'http://127.0.0.1:4174/gallery/oauth/callback/?code=sensitive-code-marker&state=test#access_token=sensitive-token-marker',
  );
  await expect(page).toHaveURL('http://127.0.0.1:4174/gallery/oauth/callback/');
  await expect(page.getByRole('status')).toContainText('could not reach');
  await expect(page.locator('body')).not.toContainText('sensitive-code-marker');
  await expect(page.locator('body')).not.toContainText(
    'sensitive-token-marker',
  );
});
