import { openRequestSettings } from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';

test('named examples, explicit null, media types and custom request values are usable', async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on('request', (request) => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname))
      external.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    }),
  );
  await page.goto('http://127.0.0.1:4174/gallery/api/gallery/v1/samplevalues/');
  await expect(
    page.getByRole('heading', { name: 'Authored example values', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Authentication is optional.', { exact: false }),
  ).toBeVisible();
  const response = page.locator('#responses');
  await expect(response.locator('pre')).toHaveText('null');
  await response
    .getByRole('combobox', { name: 'Response example', exact: true })
    .selectOption('named:zero');
  await expect(response.locator('pre')).toHaveText('0');
  await response
    .getByRole('combobox', { name: 'Response content type', exact: true })
    .selectOption('text/plain');
  expect(await response.locator('pre').textContent()).toBe(
    '  keep these spaces  ',
  );
  await expect(response.locator('.schema-view > .type-label')).toBeVisible();
  await expect(response.locator('.schema-view > .type-label')).toHaveText(
    'string',
  );
  await response.getByRole('button', { name: '204', exact: true }).click();
  await expect(response.locator('pre')).toHaveCount(0);
  await response.getByRole('button', { name: '200', exact: true }).click();
  await expect(response.locator('pre')).toHaveText('null');
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const playground = page.getByLabel('API playground');
  await playground.locator('.playground-request-example > summary').click();
  await expect(
    playground.getByRole('textbox', { name: 'Request body', exact: true }),
  ).toHaveValue('null');
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Request example', exact: true })
    .selectOption('named:zero');
  await expect(
    playground.getByRole('textbox', { name: 'Request body', exact: true }),
  ).toHaveValue('0');
  await playground
    .getByRole('textbox', { name: 'Request body', exact: true })
    .fill('42');
  await expect(
    playground.getByRole('combobox', { name: 'Request example', exact: true }),
  ).toHaveValue('');
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('text/plain');
  await expect(
    playground.getByRole('textbox', { name: 'Request body', exact: true }),
  ).toHaveValue('  keep these spaces  ');
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Requested response format', exact: true })
    .selectOption('text/plain');
  await expect(playground.locator('pre')).toContainText('Accept: text/plain');
  await expect(playground.locator('pre')).toContainText(
    "--data-raw '  keep these spaces  '",
  );
  await page.getByRole('button', { name: 'Close playground' }).click();
  await response
    .getByRole('button', { name: 'Copy code', exact: true })
    .click();
  await expect(response.getByRole('status')).toHaveText(
    'Clipboard unavailable. Select and copy the code.',
  );
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
