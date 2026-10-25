import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  addBodyField,
  expandBodyFields,
  addParameter,
} from '../helpers/request-forms.js';

test('request forms show schema metadata and optional fields, preserve exact JSON and keep mock options below examples', async ({
  page,
}) => {
  await page.goto('api/orbit/v1/create-project/?playground=open');
  const playground = page.getByLabel('API playground', { exact: true });
  await expect(
    playground
      .getByRole('group', { name: 'Request body editor', exact: true })
      .getByRole('button'),
  ).toHaveCount(2);
  await expect(
    playground.getByLabel('API server', { exact: true }),
  ).toHaveCount(0);
  await expect(
    playground.getByRole('button', { name: 'Form', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    playground.getByLabel('Body name', { exact: true }),
  ).toBeVisible();
  await expect(
    playground.getByLabel('Body description', { exact: true }),
  ).not.toBeVisible();
  await playground
    .getByLabel('Body name', { exact: true })
    .fill('Form project');
  await expandBodyFields(playground);
  await playground
    .getByRole('button', { name: 'Remove body field 2', exact: true })
    .click();
  const field = await addBodyField(playground);
  await field.locator('.body-form-key').fill('precise');
  await field.locator('.request-type-select').selectOption('number');
  await field
    .locator('.request-field-control > input')
    .fill('900719925474099312345');
  await playground
    .getByLabel('Include body field 2', { exact: true })
    .uncheck();
  await expect(
    playground.getByLabel('Body metadata', { exact: true }),
  ).toHaveValue('{"region":"eu-west"}');
  await playground.getByLabel('Include body field 2', { exact: true }).check();
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const body = playground.getByLabel('Request body', { exact: true });
  await expect(body).toHaveValue(/900719925474099312345/);
  expect(JSON.parse(await body.inputValue())).toMatchObject({
    name: 'Form project',
    metadata: { region: 'eu-west' },
  });
  await expect(body).not.toHaveValue(/description/);
  await playground.locator('.playground-request-example > summary').click();
  await expect(
    playground.locator('.playground-request-example pre'),
  ).toContainText('900719925474099312345');
  expect(
    await playground
      .locator('.playground-request-example')
      .evaluate((element) => element.nextElementSibling?.textContent),
  ).toContain('Mock response options');
  await playground
    .getByRole('button', { name: 'Send mock request', exact: true })
    .click();
  await expect(playground.locator('.response-meta')).toContainText('201');
});

test('form drafts validate without table UI or redundant hints and section sizing stays consistent', async ({
  page,
}) => {
  await page.goto('api/orbit/v1/create-project/?playground=open');
  const playground = page.getByLabel('API playground', { exact: true });
  const field = await addBodyField(playground);
  await field.locator('.body-form-key').fill('name');
  await expect(playground.getByRole('alert')).toContainText(
    'Duplicate body field',
  );
  await expect(
    playground.getByRole('button', { name: 'Send mock request', exact: true }),
  ).toBeDisabled();
  await field.locator('.body-form-key').fill('enabled');
  await field.locator('.request-type-select').selectOption('boolean');
  await field.locator('.request-field-control > input').fill('unfinished');
  await expect(playground.getByRole('alert')).toContainText('valid boolean');
  await field.locator('.request-field-control > input').fill('true');
  await expect(playground.getByRole('alert')).toHaveCount(0);
  await addParameter(playground, 'query');
  await playground
    .getByLabel('query parameter name 1', { exact: true })
    .fill('empty');
  await expect(playground).not.toContainText('Sends an empty value.');
  await playground
    .getByLabel('query parameter value 1', { exact: true })
    .fill('draft');
  await playground
    .getByLabel('Include additional query parameter 1', { exact: true })
    .uncheck();
  await expect(playground).not.toContainText('Omitted;');
  await expect(playground.locator('.request-parameter-columns')).toHaveCount(0);
  await expect(
    playground.getByRole('button', { name: 'Table', exact: true }),
  ).toHaveCount(0);
  for (const width of [360, 855, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        colorScheme,
      );
      expect(
        await playground.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('.playground-dialog').analyze())
          .violations,
      ).toEqual([]);
    }
  }
  const headers = playground.locator(
    '.request-parameter-section > summary, .playground-request-example > summary, .mock-response-controls > summary',
  );
  const geometry = await headers.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect()),
  );
  expect(new Set(geometry.map((rect) => rect.height)).size).toBe(1);
  expect(new Set(geometry.map((rect) => rect.width)).size).toBe(1);
});
