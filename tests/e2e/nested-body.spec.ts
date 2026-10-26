import { enterBodyField, clearBodyField } from '../helpers/request-forms.js';
import { openSchemaControls } from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const route = 'http://127.0.0.1:4174/gallery/api/gallery/v1/editrequestfields/';
const raw =
  '{"name":"root","enabled":false,"count":0,"id":9007199254740993,"profile":{"name":"Ada","id":9007199254740993,"privateNote":"private-note","responseOnly":"retained-read-only","address":{"city":"Old city","zip":"12345","unknown":{"huge":1e400}},"manager":{"name":"Grace","id":2},"settings":{"secret":"private-settings","choice":"private-choice","fixed":"fixture-fixed-setting"},"custom":{"precise":1.234567890123456789}},"constructor":"own","__proto__":{"keep":true},"profile.name":"literal-key"}';

test('allOf object controls retain precise and unknown values, mask secrets and send the edited body', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(route + '?playground=open');
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
    playground.getByLabel('Body profile.id', { exact: true }),
  ).toHaveValue('9007199254740993');
  await expect(
    playground.getByLabel('Body profile.privateNote', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await expect(
    playground.getByLabel('Body profile.settings.secret', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await expect(
    playground.getByLabel('Include body profile.responseOnly', { exact: true }),
  ).toHaveCount(0);
  for (const name of ['name', 'id']) {
    const headings = playground.locator('.body-field-heading').filter({
      has: page
        .locator('code')
        .filter({ hasText: new RegExp('^' + name + '$') }),
    });
    for (const heading of await headings.all())
      await expect(heading).toContainText('required');
  }
  const fields = playground.locator('.body-fields');
  for (const secret of [
    'private-choice',
    'fixture-choice-one',
    'fixture-choice-two',
    'fixture-fixed-setting',
  ])
    await expect(fields).not.toContainText(secret);
  await expect(
    playground.getByLabel('Body profile.settings.choice', { exact: true }),
  ).toHaveValue('"private-choice"');
  await playground
    .getByLabel('Body profile.settings.choice', { exact: true })
    .selectOption('"fixture-choice-two"');
  await playground.getByLabel('Body profile.id', { exact: true }).fill('-');
  await playground
    .getByLabel('Body profile.name', { exact: true })
    .fill('Edited Ada');
  await expect(
    playground.getByLabel('Body profile.id', { exact: true }),
  ).toHaveValue('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByLabel('Body profile.id', { exact: true })
    .fill('9007199254740997');
  await playground
    .getByLabel('Body profile.address.city', { exact: true })
    .fill('Berlin');
  await playground
    .getByLabel('Body profile.manager.name', { exact: true })
    .fill('Grace Hopper');
  await clearBodyField(playground, 'profile.privateNote');
  await playground.locator('.playground-request-example > summary').click();
  const code = playground.locator('.playground-request-example pre');
  await expect(code).toContainText('9007199254740997');
  await expect(code).toContainText('1.234567890123456789');
  await expect(code).not.toContainText('private-settings');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const result = page.waitForResponse('http://127.0.0.1:4010/v1/body-editor');
  page.once('dialog', (dialog) => dialog.accept());
  await playground.getByRole('button', { name: 'Send request' }).click();
  const response = await result,
    sent = response.request().postData()!;
  expect(response.status()).toBe(200);
  for (const token of [
    '9007199254740993',
    '9007199254740997',
    '1.234567890123456789',
    '1e400',
  ])
    expect(sent).toContain(token);
  const body = JSON.parse(sent);
  expect(body.profile).toMatchObject({
    name: 'Edited Ada',
    responseOnly: 'retained-read-only',
    address: { city: 'Berlin', zip: '12345' },
    manager: { name: 'Grace Hopper', id: 2 },
    settings: {
      secret: 'private-settings',
      choice: 'fixture-choice-two',
      fixed: 'fixture-fixed-setting',
    },
  });
  expect(Object.hasOwn(body.profile, 'privateNote')).toBe(false);
  expect(body['profile.name']).toBe('literal-key');
  expect(body.__proto__).toEqual({ keep: true });
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
      .getByLabel('Body profile.address.city', { exact: true })
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
    .getByLabel('Body profile.address.city', { exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await playground
      .locator('.playground-inputs')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: '.doctopus/nested-body-mobile-dark.png' });
  expect(errors).toEqual([]);
});

test('nested JSON/fields switches, omission and null toggles clear discarded errors', async ({
  page,
}) => {
  await page.goto(route + '?playground=open');
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
  await playground.getByLabel('Body profile.id', { exact: true }).fill('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByRole('button', { name: 'Edit body profile as JSON', exact: true })
    .click();
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await playground
    .getByLabel('Body profile', { exact: true })
    .fill('{"name":"incomplete","id":');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await playground
    .getByRole('button', { name: 'Edit body profile fields', exact: true })
    .click();
  await expect(
    playground.getByLabel('Body profile.id', { exact: true }),
  ).toHaveValue('9007199254740993');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await playground.getByLabel('Body profile.id', { exact: true }).fill('-');
  await clearBodyField(playground, 'profile');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await enterBodyField(playground, 'profile');
  await enterBodyField(playground, 'profile.id');
  await enterBodyField(playground, 'profile.name');
  await playground
    .getByLabel('Body profile.name', { exact: true })
    .fill('Recreated');
  await enterBodyField(playground, 'profile.address');
  await playground
    .getByLabel('Use null for body profile.address', { exact: true })
    .check();
  await expect(
    playground.getByLabel('Include body profile.address.city', { exact: true }),
  ).toHaveCount(0);
  await playground
    .getByLabel('Use null for body profile.address', { exact: true })
    .uncheck();
  await enterBodyField(playground, 'profile.address.city');
  await playground
    .getByLabel('Body profile.address.city', { exact: true })
    .fill('Berlin');
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const text = await playground
    .getByLabel('Request body', { exact: true })
    .inputValue();
  expect(JSON.parse(text).profile).toEqual({
    name: 'Recreated',
    id: 0,
    address: { city: 'Berlin' },
  });
  expect(text).toContain('9007199254740993');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
});
