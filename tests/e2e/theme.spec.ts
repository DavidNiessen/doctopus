import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { themePresets, themePalettes } from '@davidniessen/doctopus-contracts';
test('appearance settings offer prepared presets and the former custom-editor URL cannot expose editing controls', async ({
  page,
}) => {
  await page.goto(
    'http://127.0.0.1:4174/gallery/guides/components/?theme-editor=1',
  );
  await expect(
    page.getByRole('button', { name: 'Customize appearance' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Reader settings',
    exact: true,
  });
  const preset = dialog.getByRole('group', { name: 'Theme', exact: true });
  await expect(preset.getByRole('radio')).toHaveCount(5);
  await expect(dialog.getByRole('combobox')).toHaveCount(2);
  await expect(dialog.locator('input:not([type=radio])')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', { name: /Save|Copy|Delete/ }),
  ).toHaveCount(0);
  for (const value of ['mint', 'ocean', 'violet', 'neutral'] as const) {
    await preset.locator(`input[value="${value}"]`).check();
    await expect(page.locator('.docs-shell')).toHaveCSS(
      '--accent',
      themePresets[value],
    );
    const hex = themePalettes[value].light.background;
    const rgb =
      'rgb(' +
      [1, 3, 5]
        .map((index) => parseInt(hex.slice(index, index + 2), 16))
        .join(', ') +
      ')';
    await expect(page.locator('.docs-shell')).toHaveCSS(
      'background-color',
      rgb,
    );
  }
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.docs-shell')).toHaveCSS(
    '--accent',
    themePresets.neutral,
  );
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  await preset.locator('input[value=published]').check();
  await expect(page.locator('.docs-shell')).toHaveCSS(
    '--accent',
    themePresets.violet,
  );
  await dialog
    .getByRole('combobox', { name: 'Appearance mode', exact: true })
    .selectOption('dark');
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '.doctopus/prepared-themes-mobile-dark.png' });
});
test('legacy custom appearance is removed while mode, layout and recognized presets migrate', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'doctopus:reader-settings:v1:/gallery',
      JSON.stringify({
        version: 1,
        mode: 'dark',
        layout: 'classic',
        editorTheme: 'custom',
        editorColors: { background: '#ff0000' },
        theme: {
          preset: 'ocean',
          accent: '#ff0000',
          radius: 24,
          colors: { dark: { background: '#ff0000' } },
        },
        savedThemes: [{ name: 'Old custom theme', theme: {} }],
      }),
    ),
  );
  await page.goto('http://127.0.0.1:4174/gallery/api/gallery/v1/health/');
  await expect(page.locator('.docs-shell')).toHaveCSS(
    '--accent',
    themePresets.ocean,
  );
  await expect(page.locator('.docs-shell')).toHaveAttribute(
    'data-layout',
    'classic',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('doctopus:reader-settings:v1:/gallery'),
      ),
    )
    .toBeNull();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('doctopus:reader-settings:v2:/gallery')!),
  );
  expect(saved).toEqual({
    version: 2,
    mode: 'dark',
    layout: 'classic',
    theme: 'ocean',
  });
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Reader settings',
    exact: true,
  });
  await expect(dialog.locator('input:not([type=radio])')).toHaveCount(0);
  await expect(
    dialog.getByRole('combobox', {
      name: 'Response editor theme',
      exact: true,
    }),
  ).toHaveCount(0);
});

test('new readers follow the system theme and react to OS changes, including without JavaScript', async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4174/gallery/api/gallery/v1/health/');
  await expect(page.locator('.docs-shell')).toHaveCSS(
    'background-color',
    'rgb(18, 16, 23)',
  );
  await page
    .getByRole('button', { name: 'Open reader settings', exact: true })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Appearance mode', exact: true }),
  ).toHaveValue('system');
  await expect(
    page.getByRole('radio', { name: 'Site default', exact: true }),
  ).toBeChecked();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('.docs-shell')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  const context = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: 'dark',
  });
  try {
    const noJs = await context.newPage();
    await noJs.goto('http://127.0.0.1:4174/gallery/api/gallery/v1/health/');
    await expect(noJs.locator('.docs-shell')).toHaveCSS(
      'background-color',
      'rgb(18, 16, 23)',
    );
  } finally {
    await context.close();
  }
});
