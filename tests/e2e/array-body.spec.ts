import { enterBodyField } from '../helpers/request-forms.js';
import {
  openSchemaControls,
  openRequestSettings,
} from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const route =
  'http://127.0.0.1:4174/gallery/api/gallery/v1/editrequestfields/?playground=open';
const raw =
  '{"name":"root","enabled":false,"count":0,"id":9007199254740993,"options":["cat","dog"],"members":[{"name":"Ada","id":9007199254740993,"responseOnly":"keep","unknown":1e400},{"name":"Grace","id":2}],"matrix":[[1.234567890123456789,2],[]],"tokens":["private-array-token"]}';

test('array items support edits, additions and removal with precise requests and masked previews', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(route);
  const playground = page.getByLabel('API playground');
  await expect(playground).toBeVisible();
  if (await playground.getByLabel('bearer credential', { exact: true }).count())
    await playground
      .getByLabel('bearer credential', { exact: true })
      .fill('demo-token');
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground.getByLabel('Request body', { exact: true }).fill(raw);
  await openSchemaControls(playground);
  await expect(
    playground.getByLabel('Body tokens[0]', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await expect(
    playground.getByLabel('Include body members[0].responseOnly', {
      exact: true,
    }),
  ).toHaveCount(0);
  await playground
    .getByRole('button', { name: 'Remove body options[0]', exact: true })
    .click();
  await expect(
    playground.getByLabel('Body options[0]', { exact: true }),
  ).toHaveValue('dog');
  await expect(
    playground.getByLabel('Body options[0]', { exact: true }),
  ).toBeFocused();
  await playground
    .getByRole('button', { name: 'Add item to body options', exact: true })
    .click();
  await expect(
    playground.getByLabel('Body options[1]', { exact: true }),
  ).toBeFocused();
  await playground.getByLabel('Body options[1]', { exact: true }).fill('owl');
  await playground
    .getByLabel('Body members[0].name', { exact: true })
    .fill('Ada Lovelace');
  await playground
    .getByLabel('Body members[0].id', { exact: true })
    .fill('9007199254740997');
  await playground
    .getByRole('button', { name: 'Add item to body members', exact: true })
    .click();
  await enterBodyField(playground, 'members[2].name');
  await playground
    .getByLabel('Body members[2].name', { exact: true })
    .fill('New member');
  await playground.getByLabel('Body members[2].id', { exact: true }).fill('0');
  await playground
    .getByRole('button', { name: 'Add item to body matrix[1]', exact: true })
    .click();
  await playground
    .getByLabel('Body matrix[1][0]', { exact: true })
    .fill('9007199254740999');
  await playground.locator('.playground-request-example > summary').click();
  await expect(
    playground.locator('.playground-request-example pre'),
  ).not.toContainText('private-array-token');
  await expect(
    playground.locator('.playground-request-example pre'),
  ).toContainText('YOUR_SENSITIVE_VALUE');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  page.once('dialog', (dialog) => dialog.accept());
  const result = page.waitForResponse('http://127.0.0.1:4010/v1/body-editor');
  await playground.getByRole('button', { name: 'Send request' }).click();
  const response = await result,
    sent = response.request().postData()!;
  expect(response.status()).toBe(200);
  for (const token of [
    '9007199254740993',
    '9007199254740997',
    '9007199254740999',
    '1.234567890123456789',
    '1e400',
  ])
    expect(sent).toContain(token);
  const body = JSON.parse(sent);
  expect(body.options).toEqual(['dog', 'owl']);
  expect(body.members).toMatchObject([
    { name: 'Ada Lovelace', responseOnly: 'keep' },
    { name: 'Grace', id: 2 },
    { name: 'New member' },
  ]);
  expect(body.tokens).toEqual(['private-array-token']);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await playground
        .getByRole('button', { name: 'Close playground' })
        .click();
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await page.getByRole('button', { name: 'Try this endpoint' }).click();
      await playground
        .getByRole('group', { name: 'Request body editor', exact: true })
        .getByRole('button', { name: 'JSON', exact: true })
        .click();
      await playground.getByLabel('Request body', { exact: true }).fill(sent);
      await openSchemaControls(playground);
    }
    await playground
      .getByLabel('Body members[0].name', { exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await playground
    .getByLabel('Body members[0].name', { exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await playground
      .locator('.playground-inputs')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: '.doctopus/array-body-mobile-dark.png' });
  expect(errors).toEqual([]);
});

test('array reindexing discards incomplete drafts and mode changes restore valid items', async ({
  page,
}) => {
  await page.goto(route);
  const playground = page.getByLabel('API playground'),
    send = playground.getByRole('button', { name: 'Send request' });
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground.getByLabel('Request body', { exact: true }).fill(raw);
  await openSchemaControls(playground);
  await playground.getByLabel('Body members[1].id', { exact: true }).fill('-');
  await expect(send).toBeDisabled();
  await playground
    .getByRole('button', { name: 'Remove body members[0]', exact: true })
    .click();
  await expect(
    playground.getByLabel('Body members[0].name', { exact: true }),
  ).toHaveValue('Grace');
  await expect(
    playground.getByLabel('Body members[0].id', { exact: true }),
  ).toHaveValue('2');
  await expect(send).toBeEnabled();
  await playground.getByLabel('Body members[0].id', { exact: true }).fill('-');
  await playground
    .getByRole('button', { name: 'Edit body members as JSON', exact: true })
    .click();
  await expect(send).toBeEnabled();
  await playground.getByLabel('Body members', { exact: true }).fill('[{"id":');
  await expect(send).toBeDisabled();
  await playground
    .getByRole('button', { name: 'Edit body members fields', exact: true })
    .click();
  await expect(
    playground.getByLabel('Body members[0].id', { exact: true }),
  ).toHaveValue('2');
  await expect(send).toBeEnabled();
  await playground.getByLabel('Body matrix[0][0]', { exact: true }).fill('-');
  await expect(send).toBeDisabled();
  await playground
    .getByRole('button', { name: 'Add item to body matrix[0]', exact: true })
    .click();
  await expect(
    playground.getByLabel('Body matrix[0][0]', { exact: true }),
  ).toHaveValue('1.234567890123456789');
  await expect(send).toBeEnabled();
  await playground
    .getByRole('button', { name: 'Remove body options[1]', exact: true })
    .click();
  await playground
    .getByRole('button', { name: 'Remove body options[0]', exact: true })
    .click();
  await expect(
    playground.getByRole('button', {
      name: 'Add item to body options',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    playground.getByRole('button', {
      name: 'Add item to body options',
      exact: true,
    }),
  ).toBeFocused();
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const serialized = await playground
    .getByLabel('Request body', { exact: true })
    .inputValue();
  expect(JSON.parse(serialized).options).toEqual([]);
  expect(JSON.parse(serialized).members).toEqual([{ name: 'Grace', id: 2 }]);
  expect(serialized).toContain('1.234567890123456789');
});

test('root array bodies use referenced item fields and preserve exact batch requests', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(route);
  const playground = page.getByLabel('API playground');
  await expect(playground).toBeVisible();
  if (await playground.getByLabel('bearer credential', { exact: true }).count())
    await playground
      .getByLabel('bearer credential', { exact: true })
      .fill('demo-token');
  const media = 'application/vnd.doctopus.list+json';
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption(media);
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'JSON', exact: true })
    .click();
  await playground
    .getByLabel('Request body', { exact: true })
    .fill(
      '[{"name":"Ada","id":9007199254740993,"responseOnly":"retained","unknown":1e400},{"name":"Grace","id":2}]',
    );
  await openSchemaControls(playground);
  await expect(
    playground.getByLabel('Include body [0].responseOnly', { exact: true }),
  ).toHaveCount(0);
  await playground
    .getByLabel('Body [0].name', { exact: true })
    .fill('Batch Ada');
  await playground.getByLabel('Body [1].id', { exact: true }).fill('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByRole('button', { name: 'Remove body [1]', exact: true })
    .click();
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await playground
    .getByRole('button', { name: 'Add item to body $', exact: true })
    .click();
  await enterBodyField(playground, '[1].name');
  await playground
    .getByLabel('Body [1].name', { exact: true })
    .fill('New batch member');
  await playground.getByLabel('Body [1].id', { exact: true }).fill('0');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const result = page.waitForResponse('http://127.0.0.1:4010/v1/body-editor');
  page.once('dialog', (dialog) => dialog.accept());
  await playground.getByRole('button', { name: 'Send request' }).click();
  const response = await result,
    sent = response.request().postData()!;
  expect(response.status()).toBe(200);
  expect(response.request().headers()['content-type']).toBe(media);
  expect(sent).toContain('9007199254740993');
  expect(sent).toContain('1e400');
  expect(JSON.parse(sent)).toMatchObject([
    { name: 'Batch Ada', responseOnly: 'retained' },
    { name: 'New batch member' },
  ]);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await playground
        .getByRole('button', { name: 'Close playground' })
        .click();
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await page.getByRole('button', { name: 'Try this endpoint' }).click();
      await openRequestSettings(playground);
      await playground
        .getByRole('combobox', { name: 'Content type', exact: true })
        .selectOption(media);
      await playground
        .getByRole('group', { name: 'Request body editor', exact: true })
        .getByRole('button', { name: 'JSON', exact: true })
        .click();
      await playground.getByLabel('Request body', { exact: true }).fill(sent);
      await openSchemaControls(playground);
    }
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  }
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const body = playground.getByLabel('Request body', { exact: true });
  await body.fill('42');
  await expect(
    playground.getByRole('button', { name: 'Form', exact: true }),
  ).toBeDisabled();
  await body.fill('[]');
  await openSchemaControls(playground);
  await playground
    .getByRole('button', { name: 'Add item to body $', exact: true })
    .click();
  await enterBodyField(playground, '[0].name');
  await playground
    .getByLabel('Body [0].name', { exact: true })
    .fill('Created from empty');
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  expect(JSON.parse(await body.inputValue())).toEqual([
    { name: 'Created from empty' },
  ]);
  expect(errors).toEqual([]);
});
