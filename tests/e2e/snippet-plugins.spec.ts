import { openRequestSettings } from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('build-time plugin samples copy as text and stay distinct from live playground code', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    }),
  );
  await page.goto(
    'http://127.0.0.1:4176/reference/api/catalog/v1/listwidgets/',
  );
  const example = page.getByRole('complementary', {
    name: 'Request example',
    exact: true,
  });
  await example
    .getByLabel('Code language')
    .selectOption({ label: 'Go net/http (build-time)' });
  await expect(
    example.getByText('Build-time example', { exact: true }),
  ).toBeVisible();
  const code = await example.locator('pre code').innerText();
  expect(code).toContain('package main');
  await example
    .getByRole('button', { name: 'Copy request example', exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(code);
  await example
    .getByLabel('Code language')
    .selectOption({ label: 'Escaped text (build-time)' });
  await expect(example.locator('pre code')).toContainText('<script>');
  expect(
    await page.evaluate(
      () => (window as unknown as { sampleExecuted?: boolean }).sampleExecuted,
    ),
  ).toBeUndefined();
  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({
    violations: [],
  });
  await example.getByRole('button', { name: /Try now/ }).click();
  const modal = page.getByLabel('API playground');
  await modal.getByText('Request example', { exact: true }).click();
  await modal
    .getByLabel('Code language')
    .selectOption({ label: 'Go net/http (build-time)' });
  await openRequestSettings(modal);
  await modal.getByLabel('API server').fill('http://127.0.0.1:4010/v1');
  await expect(modal.locator('.code-block pre code')).toHaveText(code);
  await expect(
    modal.getByText('Playground inputs do not change this example.', {
      exact: false,
    }),
  ).toBeVisible();
  await modal.getByLabel('Code language').selectOption('JavaScript');
  await expect(modal.locator('.code-block pre code')).toContainText(
    'http://127.0.0.1:4010/v1/widgets',
  );
  await modal
    .getByLabel('Code language')
    .selectOption({ label: 'Go net/http (build-time)' });
  for (const theme of ['dark', 'light']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    expect(await new AxeBuilder({ page }).analyze()).toMatchObject({
      violations: [],
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await modal.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
