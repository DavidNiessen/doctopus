import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const route =
  'http://127.0.0.1:4174/gallery/api/gallery/v1/parameterpresence/?playground=open';
test('required values block Send and optional query/header fields are included only when filled', async ({
  page,
}) => {
  await page.goto(route);
  const form = page.getByLabel('API playground');
  await form
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const send = form.getByRole('button', { name: 'Send request', exact: true }),
    required = form.getByLabel('requiredBlank parameter', { exact: true }),
    id = form.getByLabel('id parameter', { exact: true });
  await expect(form.locator('.parameter-presence')).toHaveCount(0);
  await expect(send).toBeDisabled();
  await expect(required).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.request-validation')).toContainText(
    'requiredBlank is required.',
  );
  await required.fill('ready');
  await id.fill('example');
  const query = form.getByLabel('trace query parameter', { exact: true }),
    header = form.getByLabel('trace header parameter', { exact: true });
  await query.fill('query value');
  await header.fill('header value');
  let response = page.waitForResponse(
    (r) =>
      r.url().includes('/v1/presence/example?') &&
      r.request().method() === 'GET',
  );
  await send.click();
  let received = await response;
  expect(new URL(received.request().url()).searchParams.get('trace')).toBe(
    'query value',
  );
  expect(received.request().headers().trace).toBe('header value');
  await query.fill('');
  await header.fill('');
  response = page.waitForResponse(
    (r) =>
      r.url().includes('/v1/presence/example?') &&
      r.request().method() === 'GET',
  );
  await send.click();
  received = await response;
  expect(new URL(received.request().url()).searchParams.has('trace')).toBe(
    false,
  );
  expect(received.request().headers().trace).toBeUndefined();
  await id.fill('');
  await expect(send).toBeDisabled();
  await expect(id).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.request-validation')).toContainText(
    'id is required.',
  );
});
test('missing-field guidance stays accessible and fits compact request forms', async ({
  page,
}) => {
  await page.goto(route);
  const form = page.getByLabel('API playground');
  await page.setViewportSize({ width: 390, height: 844 });
  await form.getByLabel('id parameter', { exact: true }).fill('');
  await expect(
    form.getByRole('button', { name: 'Send request', exact: true }),
  ).toBeDisabled();
  expect(
    await form.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include('.playground-dialog').analyze())
      .violations,
  ).toEqual([]);
});
