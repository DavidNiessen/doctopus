import { test, expect } from '@playwright/test';
test('declared body fields preserve exact numbers, omit empty optional values and protect secrets on the wire', async ({
  page,
}) => {
  await page.goto(
    'http://127.0.0.1:4174/gallery/api/gallery/v1/editrequestfields/?playground=open',
  );
  const form = page.getByLabel('API playground', { exact: true });
  await form.getByRole('button', { name: 'JSON', exact: true }).click();
  await form
    .getByLabel('Request body', { exact: true })
    .fill(
      '{"name":"before","enabled":false,"count":0,"id":900719925474099312345,"metadata":{"precise":1.234567890123456789},"password":"fixture-body-password","optional":"erase"}',
    );
  await form.getByRole('button', { name: 'Form', exact: true }).click();
  await form.getByLabel('Body name', { exact: true }).fill('after');
  await form.getByLabel('Body optional', { exact: true }).fill('');
  await expect(
    form.getByLabel('Body password', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await expect(
    form.getByRole('button', { name: /Add body field|Remove body field/ }),
  ).toHaveCount(0);
  await expect(form.locator('.parameter-presence')).toHaveCount(0);
  await form
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await form.locator('.playground-request-example > summary').click();
  await expect(
    form.locator('.playground-request-example pre'),
  ).not.toContainText('fixture-body-password');
  page.on('dialog', (dialog) => dialog.accept());
  const response = page.waitForResponse('http://127.0.0.1:4010/v1/body-editor');
  await form.getByRole('button', { name: 'Send request', exact: true }).click();
  const received = await response;
  expect(received.status()).toBe(200);
  const payload = received.request().postData()!;
  expect(payload).toContain('900719925474099312345');
  expect(payload).toContain('1.234567890123456789');
  expect(payload).toContain('fixture-body-password');
  expect(JSON.parse(payload)).toMatchObject({
    name: 'after',
    enabled: false,
    count: 0,
  });
  expect(JSON.parse(payload)).not.toHaveProperty('optional');
});
