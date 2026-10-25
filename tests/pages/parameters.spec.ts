import {
  changePublishedServer,
  addParameter,
} from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('parameter rows add repeated query fields and headers, preserve toggled drafts, and remove or restore documented fields', async ({
  page,
}) => {
  await page.goto('api/orbit/v1/list-projects/?playground=open');
  const playground = page.getByLabel('API playground', { exact: true });
  await addParameter(playground, 'query');
  await playground
    .getByLabel('query parameter name 1', { exact: true })
    .fill('tag');
  await playground
    .getByLabel('query parameter value 1', { exact: true })
    .fill('a&b + café');
  await addParameter(playground, 'query');
  await playground
    .getByLabel('query parameter name 2', { exact: true })
    .fill('tag');
  const url = playground.getByLabel('Request URL', { exact: true });
  await expect(url).toContainText('?tag=a%26b%20%2B%20caf%C3%A9&tag=');
  await addParameter(playground, 'header');
  await playground
    .getByLabel('header parameter name 1', { exact: true })
    .fill('trace');
  await playground
    .getByLabel('header parameter value 1', { exact: true })
    .fill('custom-header');
  await playground.locator('.playground-request-example > summary').click();
  const snippet = playground.locator('.playground-request-example pre');
  await expect(snippet).toContainText('trace: custom-header');
  await playground
    .getByLabel('Include additional query parameter 1', { exact: true })
    .uncheck();
  await expect(url).toContainText('?tag=');
  await expect(url).not.toContainText('caf');
  await expect(
    playground.getByLabel('query parameter value 1', { exact: true }),
  ).toHaveValue('a&b + café');
  await playground
    .getByRole('button', {
      name: 'Remove additional query parameter 2',
      exact: true,
    })
    .click();
  await expect(url).not.toContainText('?');
  await playground
    .getByLabel('Include additional query parameter 1', { exact: true })
    .check();
  await expect(url).toContainText('?tag=a%26b%20%2B%20caf%C3%A9');
  await playground.getByLabel('limit parameter', { exact: true }).fill('2');
  await playground
    .getByRole('button', { name: 'Remove query parameter limit', exact: true })
    .click();
  await expect(
    playground.getByLabel('limit parameter', { exact: true }),
  ).toHaveCount(0);
  await expect(url).not.toContainText('limit=');
  await playground
    .getByRole('button', { name: 'Restore documented parameters', exact: true })
    .click();
  await expect(
    playground.getByLabel('limit parameter', { exact: true }),
  ).toHaveValue('2');
  await expect(url).toContainText('limit=2');
  expect(
    (await new AxeBuilder({ page }).include('.playground-dialog').analyze())
      .violations,
  ).toEqual([]);
});

test('custom credential fields stay out of copied examples and custom rows clear on destination changes and close', async ({
  page,
}) => {
  await page.goto('api/orbit/v1/list-projects/?playground=open');
  const playground = page.getByLabel('API playground', { exact: true });
  await addParameter(playground, 'query');
  await playground
    .getByLabel('query parameter name 1', { exact: true })
    .fill('api_key');
  await playground
    .getByLabel('query parameter value 1', { exact: true })
    .fill('private-custom-credential');
  await expect(
    playground.getByLabel('query parameter value 1', { exact: true }),
  ).toHaveAttribute('type', 'password');
  await expect(
    playground.getByLabel('Request URL', { exact: true }),
  ).toContainText('api_key=YOUR_CREDENTIAL');
  await playground.locator('.playground-request-example > summary').click();
  await expect(
    playground.locator('.playground-request-example pre'),
  ).not.toContainText('private-custom-credential');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'private-custom-credential',
  );
  await changePublishedServer(page, playground, 'https://other.example.test');
  await expect(
    playground.getByLabel('query parameter name 1', { exact: true }),
  ).toHaveCount(0);
  await addParameter(playground, 'query');
  await playground
    .getByLabel('query parameter name 1', { exact: true })
    .fill('temporary');
  await playground
    .getByLabel('query parameter value 1', { exact: true })
    .fill('in-memory');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  await expect(
    playground.getByLabel('query parameter name 1', { exact: true }),
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
