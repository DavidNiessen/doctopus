import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('documented optional parameters update the URL automatically and have no custom-field or presence controls', async ({
  page,
}) => {
  await page.goto('api/orbit/v1/list-projects/?playground=open');
  const form = page.getByLabel('API playground', { exact: true });
  const limit = form.getByLabel('limit parameter', { exact: true }),
    url = form.getByLabel('Request URL', { exact: true });
  await limit.fill('2');
  await expect(url).toContainText('limit=2');
  await limit.fill('');
  await expect(url).not.toContainText('limit=');
  await expect(
    form.locator(
      '.parameter-presence, .parameter-remove, .request-custom-field',
    ),
  ).toHaveCount(0);
  await expect(
    form.getByRole('button', {
      name: /Add .*parameter|Remove .*parameter|Restore documented/,
    }),
  ).toHaveCount(0);
  await expect(
    form.locator('.request-parameter-section').filter({ hasText: 'Headers' }),
  ).toHaveCount(0);
  await expect(
    form.getByRole('group', { name: 'Request body editor', exact: true }),
  ).toHaveCount(0);
});
test('rounded method badges stay vertically aligned and parameter forms fit the reported and compact viewports', async ({
  page,
}) => {
  for (const width of [360, 855, 1141]) {
    await page.setViewportSize({ width, height: 671 });
    await page.goto('api/orbit/v1/list-projects/?playground=open');
    const playground = page.getByLabel('API playground', { exact: true });
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode as 'light' | 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      const badge = playground.locator('.request-url-bar > .method-badge');
      const target = playground.getByLabel('Request URL', { exact: true });
      const bounds = (await badge.boundingBox())!;
      const address = (await target.boundingBox())!;
      expect(
        Math.abs(bounds.y + bounds.height / 2 - address.y - address.height / 2),
      ).toBeLessThanOrEqual(1);
      expect(
        await badge.evaluate((element) =>
          parseFloat(getComputedStyle(element).borderRadius),
        ),
      ).toBeGreaterThanOrEqual(6);
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
});

test('classic endpoint cards retain Try now and no longer show endpoint permalink links', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1141, height: 671 });
  await page.goto('api/orbit/v1/list-projects/');
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await page
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('classic');
  await page.keyboard.press('Escape');
  const row = page.locator('#classic-0-list-projects');
  await row.locator('summary').first().click();
  await expect(
    row.locator('..').getByRole('button', { name: 'Try now', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Endpoint permalink', exact: true }),
  ).toHaveCount(0);
  await expect(row.locator('.classic-endpoint-actions a')).toHaveCount(0);
});
