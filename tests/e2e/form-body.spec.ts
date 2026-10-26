import { openRequestSettings } from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('form values, literal encoded drafts and example selection send the active body safely', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(
    'http://127.0.0.1:4174/gallery/api/gallery/v1/editformvalues/',
  );
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  const playground = page.getByLabel('API playground');
  await expect(playground).toBeVisible();
  if (await playground.getByLabel('bearer credential', { exact: true }).count())
    await playground
      .getByLabel('bearer credential', { exact: true })
      .fill('demo-token');
  await playground.locator('.playground-request-example > summary').click();
  await expect(
    playground.getByRole('button', { name: 'Form values', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    playground.getByLabel('Body enabled', { exact: true }),
  ).toHaveValue('false');
  await playground.getByLabel('Body name', { exact: true }).fill('New + team');
  await playground
    .getByLabel('Body id', { exact: true })
    .fill('9007199254740993');
  await playground
    .getByLabel('Body password', { exact: true })
    .fill('fixture-replaced-form-secret');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const expected =
    'name=New+%2B+team&id=9007199254740993&enabled=false&tags=cat&tags=dog&address=%7B%22zip%22%3A%2299999%2B1234%22%7D&filters%5Blimit%5D=2&filters%5Bactive%5D=false&password=fixture-replaced-form-secret';
  await expect(playground.locator('pre')).toContainText(
    'name=New+%2B+team&id=9007199254740993',
  );
  await expect(playground.locator('pre')).not.toContainText(
    'fixture-replaced-form-secret',
  );
  await expect(playground.locator('pre')).toContainText(
    'password=YOUR_SENSITIVE_VALUE',
  );
  await playground
    .getByRole('button', { name: 'Encoded body', exact: true })
    .click();
  await expect(
    playground.getByLabel('Encoded form body', { exact: true }),
  ).toHaveValue(expected);
  const literal = 'name=Literal+body&tags=a&tags=b&password=raw-fixture-secret';
  await playground
    .getByLabel('Encoded form body', { exact: true })
    .fill(literal);
  await expect(playground.locator('pre')).toContainText('YOUR_REQUEST_BODY');
  await expect(playground.locator('pre')).not.toContainText(
    'raw-fixture-secret',
  );
  await playground
    .getByRole('button', { name: 'Form values', exact: true })
    .click();
  await expect(playground.getByLabel('Body name', { exact: true })).toHaveValue(
    'New + team',
  );
  await playground
    .getByRole('button', { name: 'Encoded body', exact: true })
    .click();
  await expect(
    playground.getByLabel('Encoded form body', { exact: true }),
  ).toHaveValue(literal);
  let result = page.waitForResponse('http://127.0.0.1:4010/v1/form-editor');
  await playground.getByRole('button', { name: 'Send request' }).click();
  let response = await result;
  expect(response.status()).toBe(200);
  expect(response.request().postData()).toBe(literal);
  expect(response.request().headers()['content-type']).toBe(
    'application/x-www-form-urlencoded',
  );
  await playground
    .getByRole('button', { name: 'Form values', exact: true })
    .click();
  result = page.waitForResponse('http://127.0.0.1:4010/v1/form-editor');
  await playground.getByRole('button', { name: 'Send request' }).click();
  response = await result;
  expect(response.request().postData()).toBe(expected);
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Request example', exact: true })
    .selectOption('named:encoded');
  await expect(
    playground.getByLabel('Encoded form body', { exact: true }),
  ).toHaveValue('name=wire+example&password=fixture-wire-only');
  await playground
    .getByRole('button', { name: 'Form values', exact: true })
    .click();
  await expect(playground.getByLabel('Body name', { exact: true })).toHaveValue(
    '',
  );
  await openRequestSettings(playground);
  await playground
    .getByRole('combobox', { name: 'Request example', exact: true })
    .selectOption('named:values');
  await expect(playground.getByLabel('Body name', { exact: true })).toHaveValue(
    'Example + team',
  );
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
