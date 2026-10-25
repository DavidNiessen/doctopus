import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('body table edits round-trip to JSON and request examples, and mock options follow the example', async ({
  page,
}) => {
  await page.goto('api/orbit/v1/create-project/?playground=open');
  const playground = page.getByLabel('API playground', { exact: true });
  await playground.getByRole('button', { name: 'Table', exact: true }).click();
  await playground
    .getByLabel('Body field value 1', { exact: true })
    .fill('Table project');
  await playground
    .getByRole('button', { name: 'Remove body field 2', exact: true })
    .click();
  await playground
    .getByLabel('Body field key 3', { exact: true })
    .fill('precise');
  await playground
    .getByLabel('Body field type 3', { exact: true })
    .selectOption('number');
  await playground
    .getByLabel('Body field value 3', { exact: true })
    .fill('900719925474099312345');
  await playground
    .getByLabel('Include body field 2', { exact: true })
    .uncheck();
  await expect(
    playground.getByLabel('Body field value 2', { exact: true }),
  ).toHaveValue('{"region":"eu-west"}');
  await playground.getByLabel('Include body field 2', { exact: true }).check();
  await playground.getByRole('button', { name: 'JSON', exact: true }).click();
  const body = playground.getByLabel('Request body', { exact: true });
  await expect(body).toHaveValue(/900719925474099312345/);
  expect(JSON.parse(await body.inputValue())).toMatchObject({
    name: 'Table project',
    metadata: { region: 'eu-west' },
  });
  await expect(body).not.toHaveValue(/description/);
  await playground.locator('.playground-request-example > summary').click();
  await expect(
    playground.locator('.playground-request-example pre'),
  ).toContainText('Table project');
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

test('body table invalid drafts block sending and remain editable; tables fit mobile and both themes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('api/orbit/v1/create-project/?playground=open');
  const playground = page.getByLabel('API playground', { exact: true });
  await playground.getByRole('button', { name: 'Table', exact: true }).click();
  await playground.getByLabel('Body field key 4', { exact: true }).fill('name');
  await expect(playground.getByRole('alert')).toContainText(
    'Duplicate body field',
  );
  await expect(
    playground.getByRole('button', { name: 'Send mock request', exact: true }),
  ).toBeDisabled();
  await playground
    .getByLabel('Body field key 4', { exact: true })
    .fill('enabled');
  await playground
    .getByLabel('Body field type 4', { exact: true })
    .selectOption('boolean');
  await playground
    .getByLabel('Body field value 4', { exact: true })
    .fill('unfinished');
  await expect(playground.getByRole('alert')).toContainText('valid boolean');
  await playground
    .getByLabel('Body field value 4', { exact: true })
    .fill('true');
  await expect(playground.getByRole('alert')).toHaveCount(0);
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
});
