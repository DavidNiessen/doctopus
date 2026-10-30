import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Violet is the published default and replacements provide complete readable palettes', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('.docs-shell')).toHaveCSS('--accent', '#7c3aed');
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Reader settings',
    exact: true,
  });
  await expect(dialog.getByRole('radio')).toHaveCount(5);
  await expect(
    dialog.getByRole('radio', { name: /Forest|Graphite/ }),
  ).toHaveCount(0);
  for (const [name, mode, bg] of [
    ['Ember', 'light', 'rgb(255, 249, 242)'],
    ['Ember', 'dark', 'rgb(27, 17, 16)'],
    ['High contrast', 'light', 'rgb(255, 255, 255)'],
    ['High contrast', 'dark', 'rgb(0, 0, 0)'],
  ] as const) {
    await dialog.getByRole('radio', { name, exact: true }).check();
    await dialog
      .getByRole('combobox', { name: 'Appearance mode', exact: true })
      .selectOption(mode);
    await expect(page.locator('.docs-shell')).toHaveCSS('background-color', bg);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});

test('saved palette and explicit dark appearance paint before a delayed application, without a fallback flash', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'doctopus:reader-settings:v2:/',
      JSON.stringify({
        version: 2,
        theme: 'ocean',
        mode: 'dark',
        layout: 'classic',
      }),
    ),
  );
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/assets/reader.js', async (route) => {
    await delayed;
    await route.continue();
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./', { waitUntil: 'commit' });
  try {
    await expect(page.locator('.docs-shell')).toBeVisible();
    await expect(page.locator('.docs-shell')).toHaveCSS(
      'background-color',
      'rgb(11, 20, 33)',
    );
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.header-tabs [data-section=all]')).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'API Reference', exact: true }),
    ).toBeHidden();
    await expect(page.locator('#doctopus-pending-appearance')).toHaveCount(1);
  } finally {
    release();
  }
  await expect(page.locator('.layout-classic')).toBeVisible();
  await expect(page.locator('#doctopus-pending-appearance')).toHaveCount(0);
  await expect(page.locator('.docs-shell')).toHaveCSS(
    'background-color',
    'rgb(11, 20, 33)',
  );
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await page.getByRole('radio', { name: 'Ember', exact: true }).check();
  await expect(page.locator('.docs-shell')).toHaveCSS(
    'background-color',
    'rgb(27, 17, 16)',
  );
  expect(errors).toEqual([]);
});

test('classic tabs use the full reference width without an All slot at desktop or compact widths', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'doctopus:reader-settings:v2:/',
      JSON.stringify({
        version: 2,
        theme: 'published',
        mode: 'system',
        layout: 'classic',
      }),
    ),
  );
  await page.goto('./');
  await expect(page.locator('.layout-classic')).toBeVisible();
  for (const width of [1920, 1600, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const tabs = page.getByRole('navigation', {
      name: 'Documentation sections',
    });
    await expect(
      tabs.getByRole('button', { name: 'All', exact: true }),
    ).toHaveCount(0);
    const first = tabs.getByRole('button', {
      name: 'API Reference',
      exact: true,
    });
    const position = await page
      .locator('.docs-layout')
      .evaluate((el) => el.getBoundingClientRect().left);
    expect((await first.boundingBox())!.x).toBeCloseTo(position + 16, 0);
    await expect(tabs.getByRole('button').nth(1)).toHaveText('Documentation');
  }
});
