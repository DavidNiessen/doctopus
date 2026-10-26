import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('body forms contain only declared fields and clearing required or optional values has explicit request behavior', async ({
  page,
}) => {
  await page.goto('api/orbit/v1/create-project/?playground=open');
  const form = page.getByLabel('API playground', { exact: true });
  const name = form.getByLabel('Body name', { exact: true }),
    description = form.getByLabel('Body description', { exact: true }),
    send = form.getByRole('button', { name: 'Send mock request', exact: true });
  await expect(
    form.getByRole('button', { name: /Add body field|Remove body field/ }),
  ).toHaveCount(0);
  await expect(form.locator('.parameter-presence')).toHaveCount(0);
  await name.fill('');
  await expect(send).toBeDisabled();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('.request-validation')).toContainText(
    'Body.name is required.',
  );
  await name.fill('Form project');
  await description.fill('');
  await form.getByRole('button', { name: 'JSON', exact: true }).click();
  const body = form.getByLabel('Request body', { exact: true });
  expect(JSON.parse(await body.inputValue())).not.toHaveProperty('description');
  await body.fill('{"name":"Form project","notInSpec":true}');
  await expect(send).toBeDisabled();
  await expect(form.locator('.request-validation')).toContainText(
    'notInSpec is not defined',
  );
  await body.fill('{"name":"Form project"}');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(form.locator('.response-meta')).toContainText('201');
  await form.locator('.playground-request-example > summary').click();
  expect(
    await form
      .locator('.playground-request-example')
      .evaluate((element) => element.nextElementSibling?.textContent),
  ).toContain('Mock response options');
});
test('spec-only request forms fit compact and desktop layouts with accessible validation', async ({
  page,
}) => {
  await page.goto('api/orbit/v1/create-project/?playground=open');
  const form = page.getByLabel('API playground', { exact: true });
  await form.getByLabel('Body name', { exact: true }).fill('');
  for (const width of [360, 855, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        colorScheme,
      );
      expect(
        await form.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('.playground-dialog').analyze())
          .violations,
      ).toEqual([]);
    }
  }
});
