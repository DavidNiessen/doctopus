import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [360, 768, 1280, 1920]) {
  test(`workspace preserves reading and request controls at ${width}px in both appearances`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const mode of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: mode });
      await page.goto('./');
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      expect(
        await page
          .locator('.guide-content p')
          .first()
          .evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          ),
      ).toBeGreaterThanOrEqual(16);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width + 1);
      const trigger = page.getByRole('button', {
        name: 'Open reader settings',
      });
      const target = await trigger.boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(width <= 760 ? 44 : 36);
      expect(target?.height).toBeGreaterThanOrEqual(width <= 760 ? 44 : 36);
      await trigger.click();
      const settings = page.getByRole('dialog', {
        name: 'Reader settings',
        exact: true,
      });
      await expect(settings).toBeVisible();
      const bounds = await settings.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await expect(
        settings.getByRole('combobox', { name: 'Preset', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();

      await page.goto('api/orbit/v1/list-projects/?playground=open');
      const playground = page.getByRole('dialog', {
        name: 'List projects playground',
        exact: true,
      });
      await expect(playground).toBeVisible();
      const send = playground.getByRole('button', {
        name: 'Send mock request',
        exact: true,
      });
      const sendBounds = await send.boundingBox();
      expect(sendBounds?.height).toBeGreaterThanOrEqual(width <= 760 ? 44 : 36);
      expect(
        await playground.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const output = playground.getByRole('region', { name: 'API response' });
      await expect(output.locator('.mock-response-controls')).toHaveCount(0);
      const pane = await output.boundingBox();
      const empty = await output.locator('.response-empty').boundingBox();
      expect(Math.abs(empty!.height - pane!.height)).toBeLessThanOrEqual(2);
      await send.click();
      await expect(playground.locator('.monaco-editor')).toBeVisible();
      const editor = await output.locator('.response-editor').boundingBox();
      expect(Math.abs(editor!.width - pane!.width)).toBeLessThanOrEqual(2);
      const code = await output.locator('.response-monaco').boundingBox();
      expect(code!.height).toBeGreaterThan(pane!.height * 0.55);
      const headers = await output
        .locator('.response-content > details')
        .boundingBox();
      expect(Math.abs(code!.y + code!.height - headers!.y)).toBeLessThanOrEqual(
        2,
      );
      const text = playground.locator('.monaco-editor textarea');
      await expect(text.first()).toHaveAttribute('readonly');
      await page.screenshot({
        path: `.doctopus/apple-workspace-${width}-${mode}.png`,
      });
      await page.keyboard.press('Escape');
    }
    expect(errors).toEqual([]);
  });
}

test('compact reading and settings reflow with doubled text and visible keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('./');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(
    await page
      .locator('.guide-content p')
      .first()
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
  ).toBeGreaterThanOrEqual(32);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(361);
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  const settings = page.getByRole('dialog', {
    name: 'Reader settings',
    exact: true,
  });
  await expect(settings).toBeVisible();
  expect(
    await settings.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() => {
      const element = document.activeElement;
      return (
        element instanceof HTMLElement &&
        element.matches(':focus-visible') &&
        getComputedStyle(element).outlineStyle !== 'none'
      );
    }),
  ).toBe(true);
  await page.screenshot({ path: '.doctopus/apple-workspace-text-200.png' });
});

test('increased contrast and reduced motion keep navigation and dialogs opaque and usable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
  await page.goto('./');
  await expect(page.locator('.site-header')).toHaveCSS(
    'backdrop-filter',
    'none',
  );
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  const settings = page.getByRole('dialog', {
    name: 'Reader settings',
    exact: true,
  });
  await expect(settings).toHaveCSS('animation-name', 'none');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await expect(settings).toBeVisible();
  await expect(
    settings.getByRole('combobox', {
      name: 'Documentation layout',
      exact: true,
    }),
  ).toBeVisible();
});
