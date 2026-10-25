import { test, expect } from '@playwright/test';

test('table additions, omissions and nested values reach the real API as exact JSON', async ({
  page,
}) => {
  await page.goto(
    'http://127.0.0.1:4174/gallery/api/gallery/v1/editrequestfields/?playground=open',
  );
  const playground = page.getByLabel('API playground', { exact: true });
  await playground
    .getByLabel('Request body', { exact: true })
    .fill(
      '{"name":"before","id":9007199254740993,"metadata":{"precise":1.234567890123456789},"password":"fixture-body-password","responseOnly":"retain"}',
    );
  await playground.getByRole('button', { name: 'Table', exact: true }).click();
  await playground
    .getByLabel('Body field value 1', { exact: true })
    .fill('after');
  await playground
    .getByLabel('Include body field 3', { exact: true })
    .uncheck();
  await playground.getByLabel('Include body field 3', { exact: true }).check();
  await expect(
    playground.getByLabel('Body field value 4', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await expect(
    playground.getByLabel('Body field value 5', { exact: true }),
  ).toHaveAttribute('readonly', '');
  await playground
    .getByLabel('Body field key 6', { exact: true })
    .fill('responseOnly');
  await expect(playground.getByRole('alert')).toContainText(
    'Duplicate body field',
  );
  await playground
    .getByLabel('Body field key 6', { exact: true })
    .fill('temporary');
  await playground
    .getByLabel('Body field value 6', { exact: true })
    .fill('discard');
  await playground
    .getByRole('button', { name: 'Remove body field 6', exact: true })
    .click();
  await playground
    .getByLabel('Body field key 6', { exact: true })
    .fill('custom');
  await playground
    .getByLabel('Body field type 6', { exact: true })
    .selectOption('array');
  await playground
    .getByLabel('Body field value 6', { exact: true })
    .fill('[true,null,900719925474099312345]');
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
  await expect(
    playground.getByRole('button', { name: 'Table', exact: true }),
  ).toBeDisabled();
});
