import { enterBodyField } from '../helpers/request-forms.js';
import { openSchemaControls } from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('body fields retain exact numbers, protect snippet secrets and send the edited JSON', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    'http://127.0.0.1:4174/gallery/api/gallery/v1/editrequestfields/',
  );
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const playground = page.getByLabel('API playground');
  await expect(playground).toBeVisible();
  if (await playground.getByLabel('bearer credential', { exact: true }).count())
    await playground
      .getByLabel('bearer credential', { exact: true })
      .fill('demo-token');
  await playground.locator('.playground-request-example > summary').click();
  const raw =
    '{"name":"before","enabled":false,"count":0,"id":9007199254740993,"mode":"auto","note":"hello","options":["cat"],"metadata":{"precise":1.234567890123456789,"huge":1e400},"password":"fixture-body-password","responseOnly":"retained-read-only-value","fixed":"fixed"}';
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground.getByLabel('Request body', { exact: true }).fill(raw);
  await openSchemaControls(playground);
  await expect(
    playground.getByLabel('Body enabled', { exact: true }),
  ).toHaveValue('false');
  await expect(playground.getByLabel('Body id', { exact: true })).toHaveValue(
    '9007199254740993',
  );
  await expect(
    playground.getByLabel('Include body responseOnly', { exact: true }),
  ).toHaveCount(0);
  await expect(
    playground.getByLabel('Body password', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await playground.getByLabel('Body count', { exact: true }).fill('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground.getByLabel('Body name', { exact: true }).fill('after');
  await expect(
    playground.getByLabel('Body count', { exact: true }),
  ).toHaveValue('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground.getByLabel('Body count', { exact: true }).fill('0');
  await playground
    .getByLabel('Body mode', { exact: true })
    .selectOption('"manual"');
  await playground
    .getByLabel('Use null for body note', { exact: true })
    .check();
  await playground
    .getByLabel('Use null for body note', { exact: true })
    .uncheck();
  await expect(playground.getByLabel('Body note', { exact: true })).toHaveValue(
    '',
  );
  await playground
    .getByLabel('Use null for body note', { exact: true })
    .check();
  await enterBodyField(playground, 'optional');
  await expect(
    playground.getByLabel('Body optional', { exact: true }),
  ).toHaveValue('example');
  await playground.getByLabel('Body optional', { exact: true }).fill('');
  await playground
    .getByRole('button', { name: 'Edit body options as JSON', exact: true })
    .click();
  await playground.getByLabel('Body options', { exact: true }).fill('[1,');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByLabel('Body options', { exact: true })
    .fill('["cat","dog"]');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await expect(playground.locator('pre')).not.toContainText(
    'fixture-body-password',
  );
  await expect(playground.locator('pre')).toContainText('YOUR_SENSITIVE_VALUE');
  await expect(playground.locator('pre')).toContainText('9007199254740993');
  await expect(playground.locator('pre')).toContainText('1.234567890123456789');
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const serialized = await playground
    .getByLabel('Request body', { exact: true })
    .inputValue();
  expect(serialized).toContain('"id": 9007199254740993');
  expect(serialized).toContain('"huge": 1e400');
  expect(serialized).toContain('"precise": 1.234567890123456789');
  expect(JSON.parse(serialized)).toMatchObject({
    name: 'after',
    enabled: false,
    count: 0,
    mode: 'manual',
    note: null,
    options: ['cat', 'dog'],
    responseOnly: 'retained-read-only-value',
  });
  await openSchemaControls(playground);
  await playground
    .getByLabel('Body name', { exact: true })
    .scrollIntoViewIfNeeded();
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('body-fields-light.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Close playground' }).click();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground.getByLabel('Request body', { exact: true }).fill(serialized);
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await openSchemaControls(playground);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  page.on('dialog', (dialog) => dialog.accept());
  const response = page.waitForResponse('http://127.0.0.1:4010/v1/body-editor');
  await playground.getByRole('button', { name: 'Send request' }).click();
  const received = await response;
  expect(received.status()).toBe(200);
  expect(received.request().postData()).toBe(serialized);
  expect(received.request().postData()).toContain('fixture-body-password');
  expect(errors).toEqual([]);
});

test('invalid drafts can return to JSON without changing the last valid body', async ({
  page,
}) => {
  await page.goto(
    'http://127.0.0.1:4174/gallery/api/gallery/v1/editrequestfields/',
  );
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const playground = page.getByLabel('API playground');
  await expect(playground).toBeVisible();
  if (await playground.getByLabel('bearer credential', { exact: true }).count())
    await playground
      .getByLabel('bearer credential', { exact: true })
      .fill('demo-token');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground.locator('.playground-request-example > summary').click();
  await openSchemaControls(playground);
  await playground.getByLabel('Body count', { exact: true }).fill('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  expect(
    JSON.parse(
      await playground.getByLabel('Request body', { exact: true }).inputValue(),
    ).count,
  ).toBe(0);
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground
    .getByLabel('Request body', { exact: true })
    .fill('{"name":"a","name":"b","enabled":false,"count":0,"id":1}');
  await expect(
    playground.getByRole('button', { name: 'Form', exact: true }),
  ).toBeDisabled();
  await expect(
    playground.getByText('Duplicate JSON properties require the raw editor.'),
  ).toBeVisible();
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await expect(playground.locator('.request-validation')).toContainText(
    'Duplicate JSON properties are not allowed',
  );
});
