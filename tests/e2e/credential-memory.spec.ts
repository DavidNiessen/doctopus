import { changePublishedServer } from '../helpers/request-forms.js';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const base = 'http://127.0.0.1:4174';
const root = '/gallery/api/gallery/v1/';
const serialized = root + 'serializeparameters/';
const bodyEditor = root + 'editrequestfields/';
const oauthRead = root + 'oauthprojects/';
const oauthWrite = root + 'createoauthproject/';
async function navigate(page: Page, path: string) {
  await page.locator(`a[data-doc-route][href="${path}"]`).first().click();
  await expect(page).toHaveURL(base + path);
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  return page.getByLabel('API playground');
}
test('credential reuse is opt-in, destination-bound, clearable and absent from persistent storage', async ({
  page,
}) => {
  await page.goto(base + serialized);
  let playground = await open(page);
  const memory = playground.getByRole('checkbox', {
    name: 'Remember for 30 minutes in this tab',
  });
  await expect(memory).not.toBeChecked();
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await memory.check();
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await expect(
    page.getByRole('button', { name: 'Forget saved API credentials' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Forget saved API credentials' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Search documentation', exact: true }),
  ).toBeFocused();
  playground = await open(page);
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await memory.check();
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await navigate(page, bodyEditor);
  playground = await open(page);
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('demo-token');
  await playground.locator('.playground-request-example > summary').click();
  await expect(
    playground.locator('.playground-request-example pre'),
  ).not.toContainText('demo-token');
  const response = page.waitForResponse('http://127.0.0.1:4010/v1/body-editor');
  page.once('dialog', (dialog) => dialog.accept());
  await playground.getByRole('button', { name: 'Send request' }).click();
  expect((await response).request().headers().authorization).toBe(
    'Bearer demo-token',
  );
  await expect(
    playground.getByText('Your response will appear here', { exact: true }),
  ).toHaveCount(0);
  await playground
    .getByRole('button', { name: 'Clear all API credentials' })
    .click();
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toBeFocused();
  await expect(
    playground.getByText('Your response will appear here', { exact: true }),
  ).toBeVisible();
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await memory.check();
  for (const destination of [
    'http://localhost:4010/v1',
    'http://127.0.0.1:4010/v2',
    'https://127.0.0.1:4010/v1',
  ]) {
    await changePublishedServer(page, playground, destination);
    await expect(
      playground.getByLabel('bearer credential', { exact: true }),
    ).toHaveValue('');
    await expect(
      playground.getByRole('checkbox', {
        name: 'Remember for 30 minutes in this tab',
      }),
    ).not.toBeChecked();
  }
  await changePublishedServer(page, playground, 'http://127.0.0.1:4010/v1');
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('demo-token');
  await playground
    .getByRole('button', { name: 'Clear bearer credential' })
    .click();
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toBeFocused();
  await playground.getByRole('button', { name: 'Close playground' }).click();
  playground = await open(page);
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      boot: document.getElementById('docs-data')?.textContent,
    }),
  );
  expect(storage).not.toContain('demo-token');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await playground
        .getByRole('button', { name: 'Close playground' })
        .click();
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      playground = await open(page);
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await playground
      .locator('.playground-inputs')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await playground
    .getByRole('checkbox', { name: 'Remember for 30 minutes in this tab' })
    .uncheck();
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('demo-token');
  await playground.getByRole('button', { name: 'Close playground' }).click();
  playground = await open(page);
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('reload-only-secret');
  await playground
    .getByRole('checkbox', { name: 'Remember for 30 minutes in this tab' })
    .check();
  await page.reload();
  playground = page.getByLabel('API playground');
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
  await expect(
    playground.getByRole('checkbox', {
      name: 'Remember for 30 minutes in this tab',
    }),
  ).not.toBeChecked();
});
test('route data from a different documentation base path cannot retain the reader credential session', async ({
  page,
}) => {
  await page.goto(base + serialized);
  const playground = await open(page);
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('namespace-fixture-secret');
  await playground
    .getByRole('checkbox', { name: 'Remember for 30 minutes in this tab' })
    .check();
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await page.evaluate(() => {
    (
      window as Window & { credentialDocumentMarker?: boolean }
    ).credentialDocumentMarker = true;
  });
  await page.route(
    '**/gallery/api/gallery/v1/editrequestfields/page-data.json',
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.config.basePath = '/another-documentation-project';
      await route.fulfill({ json: data });
    },
  );
  await Promise.all([page.waitForEvent('load'), navigate(page, bodyEditor)]);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { credentialDocumentMarker?: boolean })
          .credentialDocumentMarker,
    ),
  ).toBeUndefined();
  await open(page);
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
  await expect(
    playground.getByRole('checkbox', {
      name: 'Remember for 30 minutes in this tab',
    }),
  ).not.toBeChecked();
});

test('OAuth reuse respects required scopes and provider expiry even while the modal is closed', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(base + oauthRead);
  let playground = await open(page);
  await playground
    .getByRole('checkbox', { name: 'Remember for 30 minutes in this tab' })
    .check();
  const popupPromise = page.waitForEvent('popup');
  await playground
    .getByRole('button', { name: 'Authorize oauth with PKCE' })
    .click();
  const popup = await popupPromise;
  const closed = popup.waitForEvent('close');
  await popup.getByRole('button', { name: 'Authorize fixture client' }).click();
  await closed;
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('demo-token');
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await navigate(page, oauthWrite);
  playground = await open(page);
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await navigate(page, oauthRead);
  playground = await open(page);
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('demo-token');
  await expect(playground.locator('.auth-field time')).toHaveCount(1);
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await page.clock.fastForward(61_000);
  playground = await open(page);
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await page.clock.fastForward(30 * 60_000);
  await expect(
    page.getByRole('button', { name: 'Forget saved API credentials' }),
  ).toHaveCount(0);
});
test('clear all aborts an active API request and prevents remembered credentials from returning', async ({
  page,
}) => {
  await page.route('http://127.0.0.1:4010/v1/serialization/**', () => {});
  await page.goto(base + serialized);
  let playground = await open(page);
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground
    .getByRole('checkbox', { name: 'Remember for 30 minutes in this tab' })
    .check();
  const pending = page.waitForRequest((request) =>
    request.url().includes('/v1/serialization/'),
  );
  await playground.getByRole('button', { name: 'Send request' }).click();
  await pending;
  const aborted = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('/v1/serialization/'),
  );
  await playground
    .getByRole('button', { name: 'Clear all API credentials' })
    .click();
  expect((await aborted).failure()?.errorText).toMatch(
    /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i,
  );
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
  await expect(
    playground.getByRole('checkbox', {
      name: 'Remember for 30 minutes in this tab',
    }),
  ).not.toBeChecked();
  await expect(
    playground.getByText('Your response will appear here', { exact: true }),
  ).toBeVisible();
  await playground.getByRole('button', { name: 'Close playground' }).click();
  playground = await open(page);
  await expect(
    playground.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
});
test('clearing saved credentials cancels a pending OAuth popup and requires new consent to remember again', async ({
  page,
}) => {
  await page.goto(base + oauthRead);
  const playground = await open(page);
  await playground
    .getByRole('checkbox', { name: 'Remember for 30 minutes in this tab' })
    .check();
  const popupPromise = page.waitForEvent('popup');
  await playground
    .getByRole('button', { name: 'Authorize oauth with PKCE' })
    .click();
  const popup = await popupPromise;
  await popup.waitForURL('http://127.0.0.1:4020/authorize?**');
  const closed = popup.waitForEvent('close');
  await playground
    .getByRole('button', { name: 'Clear all API credentials' })
    .click();
  await closed;
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
  await expect(
    playground.getByRole('checkbox', {
      name: 'Remember for 30 minutes in this tab',
    }),
  ).not.toBeChecked();
  const nextPromise = page.waitForEvent('popup');
  await playground
    .getByRole('button', { name: 'Authorize oauth with PKCE' })
    .click();
  const next = await nextPromise;
  const nextClosed = next.waitForEvent('close');
  await next.getByRole('button', { name: 'Authorize fixture client' }).click();
  await nextClosed;
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('demo-token');
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await open(page);
  await expect(
    playground.getByLabel('oauth credential', { exact: true }),
  ).toHaveValue('');
});
