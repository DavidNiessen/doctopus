import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('localized endpoint details and parameter presence keep wire values and copied examples intact', async ({
  page,
  browser,
}) => {
  const root = 'http://127.0.0.1:4177/localized';
  const path = '/api/api/v1/listprojects/';
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
  await page.goto(root + path);
  await expect(
    page.getByRole('heading', { name: 'Autorisierung', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Abfrageparameter', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Antwort', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#query-parameters')).toContainText(
    'Der Parameter limit in query.',
  );
  const example = page.locator('#responses .code-block');
  const value = await example.locator('pre > code').textContent();
  await example
    .getByRole('button', { name: 'Code kopieren', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe(value);
  await page.getByRole('button', { name: 'Jetzt testen', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Projekte auflisten testen',
    exact: true,
  });
  const limit = dialog.getByLabel('Parameter limit', { exact: true });
  await expect(limit).toHaveAttribute('placeholder', 'Wert eingeben');
  await limit.fill('4');
  const presence = dialog.getByRole('checkbox', {
    name: 'In die Anfrage aufnehmen: query limit',
    exact: true,
  });
  await expect(presence).toBeChecked();
  await presence.uncheck();
  await expect(
    dialog.getByText(
      'Nicht enthalten; der eingegebene Text bleibt als Entwurf erhalten.',
    ),
  ).toHaveCount(0);
  await expect(limit).toHaveValue('4');
  await dialog
    .getByRole('button', { name: 'Anfrage-URL kopieren', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe('http://127.0.0.1:4010/v1/projects');
  await presence.check();
  await dialog
    .getByRole('button', { name: 'Anfrage-URL kopieren', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { copied: string }).copied),
    )
    .toBe('http://127.0.0.1:4010/v1/projects?limit=4');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  expect(
    (await new AxeBuilder({ page }).include('.playground-dialog').analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await page.locator('.locale-menu > summary').click();
  await page
    .locator('.locale-menu')
    .getByRole('link', { name: 'English', exact: true })
    .click();
  await expect(page).toHaveURL(root + '/en' + path);
  await expect(
    page.getByRole('heading', { name: 'Query parameters', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  await expect(page.getByLabel('limit parameter', { exact: true })).toHaveValue(
    '',
  );
  const offline = await browser.newContext({ javaScriptEnabled: false });
  try {
    const staticPage = await offline.newPage();
    await staticPage.goto(root + path);
    await expect(
      staticPage.getByRole('heading', { name: 'Autorisierung', exact: true }),
    ).toBeVisible();
    await expect(
      staticPage.getByRole('heading', {
        name: 'Abfrageparameter',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      staticPage.getByRole('heading', { name: 'Antwort', exact: true }),
    ).toBeVisible();
    await expect(
      staticPage.locator('#query-parameters code').first(),
    ).toHaveText('limit');
  } finally {
    await offline.close();
  }
  expect(errors).toEqual([]);
});
