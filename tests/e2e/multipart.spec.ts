import {
  changePublishedServer,
  openRequestSettings,
} from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const route = 'http://127.0.0.1:4174/gallery/api/gallery/v1/uploaddocuments/';
test('multipart uploads send real binary files and structured parts while previews protect sensitive fields', async ({
  page,
}) => {
  const errors: string[] = [],
    uploads: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/multipart-editor')
    )
      uploads.push(request.url());
  });
  await page.goto(route);
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const playground = page.getByLabel('API playground');
  await playground.locator('.playground-request-example > summary').click();
  const partHeader = playground.getByLabel(
    'Part documents header X-Upload-Token',
    { exact: true },
  );
  await expect(partHeader).toHaveAttribute('type', 'password');
  await partHeader.fill('private-part-token');
  await expect(
    playground.getByLabel('Part documents header Content-Type', {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByLabel('Body title', { exact: true })
    .fill('New + upload');
  await playground
    .getByLabel('Body password', { exact: true })
    .fill('changed-upload-secret');
  await playground
    .getByRole('button', { name: 'Edit body metadata as JSON', exact: true })
    .click();
  await playground
    .getByLabel('Body metadata', { exact: true })
    .fill('{"id":9007199254740993,"privateNote":"changed-private-note"}');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const bytes = Buffer.from([0, 255, 128, 13, 10, 34, 1, 254]);
  await playground
    .getByLabel('Upload documents', { exact: true })
    .setInputFiles([
      {
        name: 'private-customer.bin',
        mimeType: 'application/octet-stream',
        buffer: bytes,
      },
      {
        name: 'empty.bin',
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(0),
      },
    ]);
  const code = playground.locator('pre');
  await expect(code).toContainText('New + upload');
  await expect(code).toContainText('9007199254740993');
  await expect(code).toContainText('YOUR_SENSITIVE_VALUE');
  await expect(code).toContainText('YOUR_FILE_1');
  await expect(code).toContainText('YOUR_FILE_2');
  for (const value of [
    'changed-upload-secret',
    'changed-private-note',
    'private-customer.bin',
    'demo-token',
    'private-part-token',
  ])
    await expect(code).not.toContainText(value);
  for (const language of [
    'JavaScript',
    'TypeScript',
    'Python',
    'Java',
    'cURL',
  ]) {
    await playground
      .getByRole('combobox', { name: 'Code language' })
      .selectOption(language);
    await expect(code).toContainText('YOUR_FILE_1');
    await expect(code).not.toContainText('private-customer.bin');
    await expect(code).toContainText('YOUR_PART_HEADER');
    await expect(code).toContainText('YOUR_PART_VALUE');
    await expect(code).not.toContainText('private-part-token');
  }
  expect(uploads).toHaveLength(0);
  page.once('dialog', (dialog) => dialog.accept());
  const result = page.waitForResponse(
    'http://127.0.0.1:4010/v1/multipart-editor',
  );
  await playground.getByRole('button', { name: 'Send request' }).click();
  const response = await result;
  expect(response.status()).toBe(200);
  expect(response.request().headers()['content-type']).toMatch(
    /^multipart\/form-data; boundary=doctopus-[a-f0-9]{48}$/,
  );
  const received = await response.json();
  expect(received.partHeaders).toHaveLength(received.parts.length);
  expect(
    received.partHeaders
      .slice(-2)
      .map((headers: Record<string, string>) => headers['x-upload-token']),
  ).toEqual(['private-part-token', 'private-part-token']);
  expect(received.jsonPart).toBe(true);
  expect(received.parts).toEqual([
    { name: 'title', value: 'New + upload' },
    { name: 'password', value: 'changed-upload-secret' },
    {
      name: 'metadata',
      value: '{"id":9007199254740993,"privateNote":"changed-private-note"}',
    },
    { name: 'tags', value: 'one,two' },
    {
      name: 'documents',
      filename: 'private-customer.bin',
      contentType: 'application/octet-stream',
      base64: bytes.toString('base64'),
    },
    {
      name: 'documents',
      filename: 'empty.bin',
      contentType: 'application/octet-stream',
      base64: '',
    },
  ]);
  await expect(
    playground.getByText('2 selected · 8 bytes', { exact: true }),
  ).toBeVisible();
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Request example' })
    .selectOption('named:minimal');
  await expect(partHeader).toHaveValue('');
  await partHeader.fill('another-private-part-token');
  await expect(
    playground.getByLabel('Upload documents', { exact: true }),
  ).toHaveValue('');
  await expect(
    playground.getByLabel('Body title', { exact: true }),
  ).toHaveValue('Minimal');
  await playground
    .getByLabel('Upload documents', { exact: true })
    .setInputFiles({
      name: 'again.bin',
      mimeType: 'application/octet-stream',
      buffer: bytes,
    });
  await changePublishedServer(page, playground, 'http://127.0.0.1:4010/v1/');
  await expect(partHeader).toHaveValue('');
  await expect(
    playground.getByLabel('Upload documents', { exact: true }),
  ).toHaveValue('');
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('application/json');
  await expect(
    playground.getByLabel('Upload documents', { exact: true }),
  ).toHaveCount(0);
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('multipart/form-data');
  await expect(
    playground.getByLabel('Upload documents', { exact: true }),
  ).toHaveValue('');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  expect(uploads).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('invalid and oversized multipart inputs cannot send and valid upload controls are accessible', async ({
  page,
}) => {
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/multipart-editor')
    )
      uploads.push(request.url());
  });
  await page.goto(route);
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const playground = page.getByLabel('API playground');
  await playground.locator('.playground-request-example > summary').click();
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  await playground
    .getByLabel('Part documents header X-Upload-Token', { exact: true })
    .fill('fixture-part-token');
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground
    .getByLabel('Request body', { exact: true })
    .fill('{"title":');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground
    .getByLabel('Request body', { exact: true })
    .fill('{"title":"Valid"}');
  await playground
    .getByLabel('Upload documents', { exact: true })
    .setInputFiles({
      name: 'large.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(32 * 1024 * 1024),
    });
  await expect(playground.locator('.preview-error')).toContainText('32 MiB');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByRole('button', { name: 'Clear documents', exact: true })
    .click();
  await expect(
    playground.getByLabel('Upload documents', { exact: true }),
  ).toHaveValue('');
  await playground
    .getByLabel('Upload documents', { exact: true })
    .setInputFiles({
      name: 'small.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('file'),
    });
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.getByRole('button', { name: 'Close playground' }).click();
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await page.getByRole('button', { name: 'Try now', exact: true }).click();
    }
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.doctopus/multipart-editor.png' });
  await playground
    .locator('.multipart-editor')
    .screenshot({ path: '.doctopus/multipart-controls.png' });
  expect(uploads).toHaveLength(0);
});
