import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const route =
  'http://127.0.0.1:4174/gallery/api/gallery/v1/serializeparameters/';

test('Try now opens a focused modal with shareable URLs, keyboard dismissal and fresh credentials', async ({
  page,
}) => {
  await page.goto(route + '?ref=example#parameters');
  const trigger = page.getByRole('button', { name: 'Try now', exact: true });
  await expect(page.getByLabel('API playground')).toHaveCount(0);
  await trigger.click();
  // Match the dialog by its native role; the endpoint supplies the accessible title.
  const dialog = page.getByRole('dialog', {
    name: 'Parameter serialization playground',
  });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\?ref=example&playground=open#parameters$/);
  await expect(
    dialog.getByRole('button', { name: 'Close playground' }),
  ).toBeFocused();
  await dialog
    .getByLabel('bearer credential', { exact: true })
    .fill('session-only-secret');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\?ref=example#parameters$/);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(
    dialog.getByLabel('bearer credential', { exact: true }),
  ).toHaveValue('');
  await expect(
    dialog.getByText('Your response will appear here', { exact: true }),
  ).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  const endpointTrigger = page.getByRole('button', {
    name: 'Try this endpoint',
  });
  await endpointTrigger.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(endpointTrigger).toBeFocused();
  // Browser history can return directly to a URL whose query opens the playground.
  await page.goto(route + '?playground=open&ref=shared');
  await expect(dialog).toBeVisible();
  await page.goto('/');
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close playground' }).click();
  await expect(page).toHaveURL(/\?ref=shared$/);
  await expect(page.locator('html')).not.toHaveAttribute(
    'style',
    /overflow: hidden/,
  );
});

test('modal is accessible in both themes, traps focus and fits mobile screens', async ({
  page,
}) => {
  for (const theme of ['light', 'dark']) {
    await page.goto(route);
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.getByRole('button', { name: 'Try now', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Parameter serialization playground',
    });
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    for (let index = 0; index < 18; index++) {
      await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    await page.screenshot({ path: `.doctopus/playground-modal-${theme}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBeLessThanOrEqual(390);
    expect(bounds?.height).toBeLessThanOrEqual(844);
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await dialog
      .getByRole('button', { name: 'Send request' })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole('button', { name: 'Send request' }),
    ).toBeInViewport();
    await page.screenshot({
      path: `.doctopus/playground-modal-mobile-${theme}.png`,
    });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test('closing the playground aborts an in-flight request', async ({ page }) => {
  const api = 'http://127.0.0.1:4010/v1/serialization/**';
  await page.route(api, () => {
    /* Deliberately leave the request pending. */
  });
  await page.goto(route + '?playground=open');
  const dialog = page.getByRole('dialog', {
    name: 'Parameter serialization playground',
  });
  await dialog
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  const pending = page.waitForRequest((request) =>
    request.url().includes('/v1/serialization/'),
  );
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await pending;
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().includes('/v1/serialization/'),
  );
  await page.keyboard.press('Escape');
  expect((await failed).failure()?.errorText).toMatch(
    /ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i,
  );
  await expect(dialog).not.toBeVisible();
});
