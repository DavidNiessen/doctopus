import { test, expect } from '@playwright/test';
import { addBodyField, expandBodyFields } from '../helpers/request-forms.js';

test('body forms preserve exact JSON, omitted drafts, nested values and secrets on the actual wire', async ({
  page,
}) => {
  await page.goto(
    'http://127.0.0.1:4174/gallery/api/gallery/v1/editrequestfields/?playground=open',
  );
  const playground = page.getByLabel('API playground', { exact: true });
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  await playground
    .getByLabel('Request body', { exact: true })
    .fill(
      '{"name":"before","id":9007199254740993,"metadata":{"precise":1.234567890123456789},"password":"fixture-body-password","responseOnly":"retain"}',
    );
  await playground.getByRole('button', { name: 'Form', exact: true }).click();
  await expandBodyFields(playground);
  await playground.getByLabel('Body name', { exact: true }).fill('after');
  await playground
    .getByLabel('Include body field 3', { exact: true })
    .uncheck();
  await playground.getByLabel('Include body field 3', { exact: true }).check();
  await expect(
    playground.getByLabel('Body password', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await expect(
    playground.getByLabel('Body responseOnly', { exact: true }),
  ).toHaveAttribute('readonly', '');
  const custom = await addBodyField(playground);
  await custom.locator('.body-form-key').fill('responseOnly');
  await expect(playground.getByRole('alert')).toContainText(
    'Duplicate body field',
  );
  await custom.locator('.body-form-key').fill('custom');
  await custom.locator('.request-type-select').selectOption('array');
  await custom.locator('textarea').fill('[true,null,900719925474099312345]');
  const temporary = await addBodyField(playground);
  await temporary.locator('.body-form-key').fill('temporary');
  await temporary.getByRole('button', { name: /Remove body field/ }).click();
  await expect(
    playground.getByRole('button', { name: 'Add body field', exact: true }),
  ).toBeFocused();
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground.locator('.playground-request-example > summary').click();
  await expect(
    playground.locator('.playground-request-example pre'),
  ).not.toContainText('fixture-body-password');
  page.on('dialog', (dialog) => dialog.accept());
  const response = page.waitForResponse('http://127.0.0.1:4010/v1/body-editor');
  await playground
    .getByRole('button', { name: 'Send request', exact: true })
    .click();
  const received = await response;
  expect(received.status()).toBe(200);
  const payload = received.request().postData()!;
  expect(payload).toContain('900719925474099312345');
  expect(payload).toContain('1.234567890123456789');
  expect(payload).toContain('fixture-body-password');
  expect(payload).not.toContain('temporary');
  expect(JSON.parse(payload)).toMatchObject({
    name: 'after',
    responseOnly: 'retain',
    custom: [true, null, expect.any(Number)],
  });
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  await playground
    .getByLabel('Request body', { exact: true })
    .fill('{"":"retained"}');
  await playground.getByRole('button', { name: 'Form', exact: true }).click();
  await expect(playground.locator('.body-schema-fields')).toHaveAttribute(
    'open',
    '',
  );
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(
    playground.getByLabel('Request body', { exact: true }),
  ).toHaveValue('{"":"retained"}');
});
