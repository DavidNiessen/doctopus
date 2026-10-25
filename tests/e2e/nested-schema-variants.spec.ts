import {
  openSchemaControls,
  openRequestSettings,
} from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
const route =
  'http://127.0.0.1:4174/gallery/api/gallery/v1/editbodyvariants/?playground=open';
async function open(page: Page) {
  await page.goto(route);
  const playground = page.getByLabel('API playground');
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('application/vnd.doctopus.nested+json');
  await openSchemaControls(playground);
  return playground;
}

test('nested choices preserve other drafts, numeric tokens and hidden values, and send precise real bytes', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const playground = await open(page);
  // Install precise/unknown body values before entering fields again.
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground
    .getByLabel('Request body', { exact: true })
    .fill(
      '{"counter":3,"payload":{"kind":"person","name":"Ada","id":9007199254740993,"extra":1.234567890123456789,"token":"private-payload-token"},"payload.name":42,"items":[],"privatePayload":{"kind":"person","name":"private-inherited","token":"private-nested-token"},"lists":["Ada"]}',
    );
  await openSchemaControls(playground);
  const branch = playground.getByRole('combobox', {
    name: 'Schema branch for body payload',
    exact: true,
  });
  await branch.selectOption('0');
  await expect(
    playground.getByLabel('Body payload.name', { exact: true }),
  ).toHaveValue('Ada');
  await playground
    .getByLabel('Body ["payload.name"]', { exact: true })
    .fill('-');
  await playground.getByLabel('Body counter', { exact: true }).fill('-');
  await branch.selectOption('1');
  await expect(
    playground.getByLabel('Body ["payload.name"]', { exact: true }),
  ).toHaveValue('-');
  await expect(
    playground.getByLabel('Body counter', { exact: true }),
  ).toHaveValue('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground.getByLabel('Body counter', { exact: true }).fill('3');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByLabel('Body ["payload.name"]', { exact: true })
    .fill('42');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await playground
    .getByRole('button', {
      name: 'Use fixed value for body payload.kind',
      exact: true,
    })
    .click();
  await playground
    .getByLabel('Include body payload.company', { exact: true })
    .check();
  await playground
    .getByLabel('Body payload.company', { exact: true })
    .fill('New company');
  await branch.selectOption('0');
  await expect(
    playground.getByLabel('Body payload.name', { exact: true }),
  ).toHaveValue('Ada');
  await playground
    .getByLabel('Body payload.name', { exact: true })
    .fill('Updated name');
  await branch.selectOption('2');
  await expect(
    playground.getByLabel('Include body payload', { exact: true }),
  ).toBeDisabled();
  await expect(branch).toHaveValue('2');
  await expect(
    playground.getByLabel('Body payload.name', { exact: true }),
  ).toHaveCount(0);
  await branch.selectOption('0');
  await expect(
    playground.getByLabel('Body payload.name', { exact: true }),
  ).toHaveValue('Updated name');
  await playground
    .getByRole('combobox', {
      name: 'Schema branch for body privatePayload',
      exact: true,
    })
    .selectOption('0');
  await expect(
    playground.getByLabel('Body privatePayload.name', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await playground.locator('.playground-request-example > summary').click();
  const preview = playground.locator('.playground-request-example pre');
  for (const value of [
    'private-inherited',
    'private-nested-token',
    'private-payload-token',
  ])
    await expect(preview).not.toContainText(value);
  await expect(preview).toContainText('YOUR_SENSITIVE_VALUE');
  await expect(preview).toContainText('9007199254740993');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const raw = await playground
    .getByLabel('Request body', { exact: true })
    .inputValue();
  for (const expected of [
    '9007199254740993',
    '1.234567890123456789',
    'New company',
    'Updated name',
    'private-inherited',
  ])
    expect(raw).toContain(expected);
  const response = page.waitForResponse(
    (response) =>
      response.url() === 'http://127.0.0.1:4010/v1/body-variants' &&
      response.request().method() === 'POST',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await playground.getByRole('button', { name: 'Send request' }).click();
  expect(
    ((await (await response).json()) as { received: string }).received,
  ).toBe(raw);
  expect(errors).toEqual([]);
});

test('array structural edits clear item choices and drafts without changing unrelated fields', async ({
  page,
}) => {
  const playground = await open(page);
  const first = playground.getByRole('combobox', {
    name: 'Schema branch for body items[0]',
    exact: true,
  });
  const second = playground.getByRole('combobox', {
    name: 'Schema branch for body items[1]',
    exact: true,
  });
  await first.selectOption('0');
  await second.selectOption('1');
  await playground.getByLabel('Body counter', { exact: true }).fill('-');
  await playground
    .getByLabel('Include body items[0].count', { exact: true })
    .check();
  await playground.getByLabel('Body items[0].count', { exact: true }).fill('-');
  await playground
    .getByRole('button', { name: 'Remove body items[0]', exact: true })
    .click();
  await expect(first).toHaveValue('');
  await expect(first).toBeFocused();
  await expect(second).toHaveCount(0);
  await expect(
    playground.getByLabel('Body counter', { exact: true }),
  ).toHaveValue('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await first.selectOption('1');
  await expect(
    playground.getByLabel('Body items[0].company', { exact: true }),
  ).toHaveValue('Second');
  await playground.getByLabel('Body counter', { exact: true }).fill('3');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await playground
    .getByRole('button', { name: 'Add item to body items', exact: true })
    .click();
  await expect(first).toHaveValue('');
  await expect(second).toHaveValue('');
  await expect(second).toBeFocused();
  await second.selectOption('0');
  await playground
    .getByRole('button', {
      name: 'Initialize body items[1] as object',
      exact: true,
    })
    .click();
  await playground
    .getByLabel('Include body items[1].kind', { exact: true })
    .check();
  await playground
    .getByLabel('Include body items[1].name', { exact: true })
    .check();
  await playground
    .getByLabel('Body items[1].name', { exact: true })
    .fill('New item');
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const raw = await playground
    .getByLabel('Request body', { exact: true })
    .inputValue();
  expect(raw).toContain('Second');
  expect(raw).toContain('New item');
  expect(raw).not.toContain('First');
  await openSchemaControls(playground);
  await expect(first).toHaveValue('');
  await expect(second).toHaveValue('');
});

test('nested JSON and omission reset descendant choices while preserving the container selection', async ({
  page,
}) => {
  const playground = await open(page);
  const optional = playground.getByRole('combobox', {
    name: 'Schema branch for body optionalPayload',
    exact: true,
  });
  const child = playground.getByRole('combobox', {
    name: 'Schema branch for body optionalPayload.child',
    exact: true,
  });
  await optional.selectOption('0');
  await child.selectOption('0');
  await playground
    .getByLabel('Use null for body optionalPayload', { exact: true })
    .check();
  await expect(child).toHaveCount(0);
  await playground
    .getByLabel('Use null for body optionalPayload', { exact: true })
    .uncheck();
  await expect(optional).toHaveValue('0');
  await expect(child).toHaveValue('');
  const branch = playground.getByRole('combobox', {
    name: 'Schema branch for body lists',
    exact: true,
  });
  await branch.selectOption('1');
  // The old string item is retained; replacing its value is an explicit JSON edit.
  await playground
    .getByLabel('Body lists[0]', { exact: true })
    .fill('{"kind":"organization","company":"Edited company"}');
  await expect(
    playground.getByLabel('Body lists[0].company', { exact: true }),
  ).toHaveValue('Edited company');
  await playground
    .getByRole('button', { name: 'Edit body lists as JSON', exact: true })
    .click();
  await expect(branch).toHaveValue('1');
  await playground
    .getByLabel('Body lists', { exact: true })
    .fill('[{"kind":"organization","company":"JSON company"}]');
  await playground
    .getByRole('button', { name: 'Edit body lists fields', exact: true })
    .click();
  await expect(
    playground.getByLabel('Body lists[0].company', { exact: true }),
  ).toHaveValue('JSON company');
  await playground.getByLabel('Include body lists', { exact: true }).uncheck();
  await expect(branch).toHaveValue('1');
  await playground.getByLabel('Include body lists', { exact: true }).check();
  await playground
    .getByRole('button', { name: 'Add item to body lists', exact: true })
    .click();
  await playground
    .getByLabel('Include body lists[0].company', { exact: true })
    .check();
  await playground
    .getByLabel('Body lists[0].company', { exact: true })
    .fill('Restored empty list');
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.getByRole('button', { name: 'Try this endpoint' }).click();
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('application/vnd.doctopus.nested+json');
  await openSchemaControls(playground);
  await playground
    .getByRole('combobox', {
      name: 'Schema branch for body payload',
      exact: true,
    })
    .selectOption('0');
  await page.setViewportSize({ width: 390, height: 844 });
  await playground
    .getByLabel('Body payload.name', { exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await playground
      .locator('.playground-inputs')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: '.doctopus/nested-schema-variants-mobile-dark.png',
  });
});
