import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const route =
  'http://127.0.0.1:4174/gallery/api/gallery/v1/serializeparameters/';
const settingsKey = 'doctopus:reader-settings:v2:/gallery';
async function settings(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open reader settings' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Reader settings',
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('prepared themes and classic layout persist without changing project defaults', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(route);
  const originalAccent = await page
    .locator('.docs-shell')
    .evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--accent'),
    );
  const dialog = await settings(page);
  await dialog
    .getByRole('combobox', { name: 'Appearance mode', exact: true })
    .selectOption('dark');
  await dialog
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('classic');
  await dialog
    .getByRole('combobox', { name: 'Preset', exact: true })
    .selectOption('ocean');
  await expect(dialog.locator('input')).toHaveCount(0);
  await expect(dialog.locator('option[value=custom]')).toHaveCount(0);
  await expect(page.locator('.docs-shell')).toHaveCSS('--accent', '#2563eb');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.docs-shell')).toHaveAttribute(
    'data-layout',
    'classic',
  );
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Open reader settings' }),
  ).toBeFocused();
  await expect(
    page.getByRole('separator', { name: 'Resize navigation', exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'API endpoint reference' }),
  ).toBeVisible();
  await expect(page.locator('.endpoint-disclosure').first()).toBeVisible();
  await expect(page.locator('.endpoint-disclosure[open]')).toHaveCount(0);
  await expect(page.locator('.sidebar')).not.toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '.doctopus/classic-layout-dark.png' });
  await page.reload();
  await expect(page.locator('.docs-shell')).toHaveAttribute(
    'data-layout',
    'classic',
  );
  await expect(page.locator('.docs-shell')).toHaveCSS('--accent', '#2563eb');
  const again = await settings(page);
  await again
    .getByRole('combobox', { name: 'Preset', exact: true })
    .selectOption('published');
  await expect(page.locator('.docs-shell')).toHaveCSS(
    '--accent',
    originalAccent,
  );
  await again
    .getByRole('combobox', { name: 'Documentation layout', exact: true })
    .selectOption('modern');
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('separator', { name: 'Resize navigation', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('response editor follows reader appearance and presets across tabs without losing folding or exact copying', async ({
  page,
  context,
}) => {
  const raw =
    '{"profile":{"name":"Ada","precise":9007199254740993},"ok":true}\n';
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem('settings-response-copy', text);
        },
      },
    }),
  );
  await page.route('http://127.0.0.1:4010/v1/serialization/**', (request) =>
    request.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization',
        'access-control-allow-methods': 'GET, OPTIONS',
      },
      body: raw,
    }),
  );
  await page.goto(route + '?playground=open');
  const playground = page.getByLabel('API playground');
  await playground
    .getByLabel('bearer credential', { exact: true })
    .fill('demo-token');
  await playground.getByRole('button', { name: 'Send request' }).click();
  const editor = playground.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  await playground
    .getByRole('button', { name: 'Collapse all', exact: true })
    .click();
  await expect(
    editor.locator('.codicon-folding-collapsed').first(),
  ).toBeVisible();
  const other = await context.newPage();
  await other.goto(route);
  const dialog = await settings(other);
  const editorBackground = () =>
    editor.evaluate((element) => getComputedStyle(element).backgroundColor);
  const shellBackground = () =>
    page
      .locator('.docs-shell')
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--bg').trim(),
      );
  const keyColor = () =>
    editor
      .locator('.view-lines span')
      .filter({ hasText: '"profile"' })
      .last()
      .evaluate((element) => getComputedStyle(element).color);
  await dialog
    .getByRole('combobox', { name: 'Appearance mode', exact: true })
    .selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(editor).toHaveClass(/\bvs\b/);
  expect(await editorBackground()).toBe('rgb(255, 255, 255)');
  await expect(
    editor.locator('.codicon-folding-collapsed').first(),
  ).toBeVisible();
  await playground
    .getByRole('button', { name: 'Expand all', exact: true })
    .click();
  const lightKey = await keyColor();
  await dialog
    .getByRole('combobox', { name: 'Preset', exact: true })
    .selectOption('ocean');
  await expect(page.locator('.docs-shell')).toHaveCSS('--accent', '#2563eb');
  await expect.poll(keyColor).not.toBe(lightKey);
  await playground
    .getByRole('button', { name: 'Collapse all', exact: true })
    .click();
  await dialog
    .getByRole('combobox', { name: 'Appearance mode', exact: true })
    .selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(editor).toHaveClass(/vs-dark/);
  expect(await shellBackground()).toBe('#18181b');
  await expect(editor).toHaveCSS('background-color', 'rgb(24, 24, 27)');
  await expect(
    editor.locator('.codicon-folding-collapsed').first(),
  ).toBeVisible();
  await expect(editor.locator('textarea').first()).toHaveJSProperty(
    'readOnly',
    true,
  );
  await playground
    .getByRole('button', { name: 'View response fullscreen' })
    .click();
  const fullscreen = page.getByRole('dialog', {
    name: 'Response body',
    exact: true,
  });
  await expect(fullscreen.locator('.monaco-editor')).toHaveClass(/vs-dark/);
  await expect(
    fullscreen.locator('.codicon-folding-collapsed').first(),
  ).toBeVisible();
  await fullscreen
    .getByRole('button', { name: 'Copy entire response' })
    .click();
  expect(
    await page.evaluate(() => sessionStorage.getItem('settings-response-copy')),
  ).toBe(raw);
  await dialog
    .getByRole('combobox', { name: 'Appearance mode', exact: true })
    .selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(fullscreen.locator('.monaco-editor')).toHaveClass(/\bvs\b/);
  await expect(fullscreen.locator('.monaco-editor')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(fullscreen.locator('.monaco-editor')).toHaveClass(/vs-dark/);
  await expect(fullscreen.locator('.monaco-editor')).toHaveCSS(
    'background-color',
    'rgb(24, 24, 27)',
  );
  await page.keyboard.press('Escape');
  await expect(playground).toBeVisible();
  await other.close();
});

test('All is the default and documentation/API filters change sidebar items and track history', async ({
  page,
}) => {
  await page.goto(route);
  const navigation = page.getByRole('navigation', {
    name: 'Documentation sections',
  });
  const sidebar = page.getByRole('complementary', {
    name: 'Documentation navigation',
  });
  await expect(
    navigation.getByRole('button', { name: 'All', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(sidebar.locator('.endpoint-link').first()).toBeVisible();
  await expect(
    sidebar.locator('.nav-group a:not(.endpoint-link)').first(),
  ).toBeVisible();
  await navigation
    .getByRole('button', { name: 'Documentation', exact: true })
    .click();
  await expect(page).toHaveURL(/\/guides\//);
  await expect(sidebar.locator('.endpoint-link')).toHaveCount(0);
  await expect(sidebar.locator('.nav-group a').first()).toBeVisible();
  await navigation
    .getByRole('button', { name: 'API Reference', exact: true })
    .click();
  await expect(page).toHaveURL(/\/api\//);
  await expect(sidebar.locator('.nav-group a:not(.endpoint-link)')).toHaveCount(
    0,
  );
  await expect(sidebar.locator('.endpoint-link').first()).toBeVisible();
  await page.goBack();
  await expect(
    navigation.getByRole('button', { name: 'Documentation', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await navigation.getByRole('button', { name: 'All', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(sidebar.locator('.endpoint-link').first()).toBeVisible();
  await page.reload();
  await expect(
    navigation.getByRole('button', { name: 'All', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await navigation
    .getByRole('button', { name: 'API Reference', exact: true })
    .click();
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(sidebar.locator('.endpoint-link').first()).toBeVisible();
  await expect(sidebar.locator('.nav-group a:not(.endpoint-link)')).toHaveCount(
    0,
  );
});

test('settings tolerate blocked/corrupt storage, follow the system, and fit compact viewports', async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{"version":999,"layout":"broken"}'),
    settingsKey,
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(route);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.docs-shell')).toHaveAttribute(
    'data-layout',
    'modern',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    };
    Storage.prototype.getItem = () => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    };
  });
  const dialog = await settings(page);
  await dialog
    .getByRole('combobox', { name: 'Appearance mode', exact: true })
    .selectOption('dark');
  await expect(dialog).toContainText('Settings work for this visit.');
  for (const layout of ['classic', 'modern']) {
    await dialog
      .getByRole('combobox', { name: 'Documentation layout', exact: true })
      .selectOption(layout);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: '.doctopus/reader-settings-mobile-dark.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const sidebar = page.locator('.sidebar');
  // Some native/headless platforms suppress scrollbars even for `thin`.
  // Compare against the platform's resolved value instead of overriding it.
  const nativeThin = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText =
      'scrollbar-width:thin;overflow:scroll;width:20px;height:20px';
    document.body.append(probe);
    const width = getComputedStyle(probe).scrollbarWidth;
    probe.remove();
    return width;
  });
  await expect(sidebar).toHaveCSS('scrollbar-width', nativeThin);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(sidebar).toHaveCSS('scrollbar-color', 'auto');
});
