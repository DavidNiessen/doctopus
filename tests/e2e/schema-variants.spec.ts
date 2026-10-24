import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const route =
  'http://127.0.0.1:4174/gallery/api/gallery/v1/editbodyvariants/?playground=open';
const raw =
  '{"kind":"person","id":9007199254740993,"name":"Ada","count":2,"token":"fixture-variant-secret","secretFixed":"current-private-fixed","responseOnly":"retained","extra":{"precise":1.234567890123456789,"huge":1e400}}';

test('oneOf controls require explicit selection and preserve values, privacy and precise real requests across branches', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(route);
  const playground = page.getByLabel('API playground');
  const branch = playground.getByRole('combobox', {
    name: 'Request body schema branch',
  });
  const fields = playground.getByRole('button', {
    name: 'Fields',
    exact: true,
  });
  await expect(fields).toBeDisabled();
  await playground.getByLabel('Request body', { exact: true }).fill(raw);
  await branch.selectOption('0');
  await expect(
    playground.getByLabel('Request body', { exact: true }),
  ).toHaveValue(raw);
  await fields.click();
  await expect(playground.getByLabel('Body id', { exact: true })).toHaveValue(
    '9007199254740993',
  );
  await expect(
    playground.getByLabel('Include body responseOnly', { exact: true }),
  ).toHaveCount(0);
  await expect(
    playground.getByLabel('Body token', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await expect(playground.locator('.body-fields')).not.toContainText(
    'fixture-fixed-variant-secret',
  );
  await expect(playground.locator('.body-fields')).not.toContainText(
    'current-private-fixed',
  );
  await playground
    .getByRole('button', {
      name: 'Use fixed value for body secretFixed',
      exact: true,
    })
    .click();
  await playground.getByLabel('Body id', { exact: true }).fill('-');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await branch.selectOption('1');
  await expect(playground.getByLabel('Body id', { exact: true })).toHaveValue(
    '9007199254740993',
  );
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await expect(
    playground.getByRole('button', {
      name: 'Use fixed value for body kind',
      exact: true,
    }),
  ).toBeVisible();
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(
    playground.getByLabel('Request body', { exact: true }),
  ).toHaveValue(/"kind":\s*"person"/);
  await fields.click();
  await playground
    .getByRole('button', { name: 'Use fixed value for body kind', exact: true })
    .click();
  await playground.getByLabel('Include body company', { exact: true }).check();
  await playground.getByLabel('Body company', { exact: true }).fill('New Lab');
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const sent = await playground
    .getByLabel('Request body', { exact: true })
    .inputValue();
  for (const expected of [
    '"kind": "organization"',
    '"name": "Ada"',
    '"company": "New Lab"',
    '9007199254740993',
    '1.234567890123456789',
    '1e400',
    '"responseOnly": "retained"',
    'fixture-fixed-variant-secret',
  ])
    expect(sent).toContain(expected);
  await playground.locator('.playground-request-example > summary').click();
  const preview = playground.locator('.playground-request-example pre');
  for (const secret of [
    'fixture-variant-secret',
    'fixture-fixed-variant-secret',
    'current-private-fixed',
  ])
    await expect(preview).not.toContainText(secret);
  await expect(preview).toContainText('YOUR_SENSITIVE_VALUE');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const response = page.waitForResponse(
    (response) =>
      response.url() === 'http://127.0.0.1:4010/v1/body-variants' &&
      response.request().method() === 'POST',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await playground.getByRole('button', { name: 'Send request' }).click();
  expect(
    ((await (await response).json()) as { received: string }).received,
  ).toBe(sent);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: '.doctopus/schema-variants-light.png' });
  expect(errors).toEqual([]);
});

test('anyOf array branches retain existing items, allow explicit additions and discard incomplete drafts on switches', async ({
  page,
}) => {
  await page.goto(route);
  const playground = page.getByLabel('API playground');
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('application/vnd.doctopus.variants+json');
  const branch = playground.getByRole('combobox', {
    name: 'Request body schema branch',
  });
  await branch.selectOption('0');
  await playground.getByRole('button', { name: 'Fields', exact: true }).click();
  await playground
    .getByLabel('Body [0].company', { exact: true })
    .fill('Retained company');
  await playground
    .getByRole('button', { name: 'Edit body [0] as JSON', exact: true })
    .click();
  await playground.getByLabel('Body [0]', { exact: true }).fill('{');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeDisabled();
  await branch.selectOption('1');
  await expect(
    playground.getByRole('button', { name: 'Send request' }),
  ).toBeEnabled();
  await branch.selectOption('0');
  await expect(
    playground.getByLabel('Body [0].company', { exact: true }),
  ).toHaveValue('Retained company');
  await playground
    .getByRole('button', { name: 'Add item to body $', exact: true })
    .click();
  await playground.getByLabel('Include body [1].kind', { exact: true }).check();
  await playground
    .getByLabel('Include body [1].company', { exact: true })
    .check();
  await playground
    .getByLabel('Body [1].company', { exact: true })
    .fill('Second company');
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const retained = await playground
    .getByLabel('Request body', { exact: true })
    .inputValue();
  expect(retained).toContain('Retained company');
  expect(retained).toContain('Second company');
  expect(retained).toContain('"kind": "organization"');
  await branch.selectOption('');
  await expect(
    playground.getByRole('button', { name: 'Fields', exact: true }),
  ).toBeDisabled();
  await expect(
    playground.getByLabel('Request body', { exact: true }),
  ).toHaveValue(retained);
  await branch.selectOption('0');
  await playground.getByRole('button', { name: 'Fields', exact: true }).click();
  await playground.getByRole('button', { name: 'Close playground' }).click();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.getByRole('button', { name: 'Try this endpoint' }).click();
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('application/vnd.doctopus.variants+json');
  await branch.selectOption('0');
  await playground.getByRole('button', { name: 'Fields', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await playground
    .getByLabel('Body [0].company', { exact: true })
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
  await playground.getByLabel('Request URL', { exact: true }).focus();
  await expect(
    playground.getByLabel('Request URL', { exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: '.doctopus/schema-variants-mobile-dark.png' });
});

test('unsupported sibling constraints retain JSON and example/media resets clear prior editing selections', async ({
  page,
}) => {
  await page.goto(route);
  const playground = page.getByLabel('API playground');
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('application/vnd.doctopus.constrained+json');
  const raw = await playground
    .getByLabel('Request body', { exact: true })
    .inputValue();
  const branch = playground.getByRole('combobox', {
    name: 'Request body schema branch',
  });
  for (const choice of ['0', '1']) {
    await branch.selectOption(choice);
    await expect(
      playground.getByRole('button', { name: 'Fields', exact: true }),
    ).toBeDisabled();
    await expect(
      playground.getByLabel('Request body', { exact: true }),
    ).toHaveValue(raw);
    await expect(playground.locator('.body-editor')).toContainText(
      'additional constraints',
    );
  }
  await playground
    .getByRole('combobox', { name: 'Content type', exact: true })
    .selectOption('application/json');
  await expect(branch).toHaveValue('');
  await expect(
    playground.getByRole('button', { name: 'Fields', exact: true }),
  ).toBeDisabled();
});
