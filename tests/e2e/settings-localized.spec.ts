import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const root = 'http://127.0.0.1:4177/localized';
const operation = '/api/api/v1/listprojects/';

test('localized prepared themes retain portable choices across languages and fit mobile settings', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(root + operation);
  const open = page.getByRole('button', {
    name: 'Leseeinstellungen öffnen',
    exact: true,
  });
  await open.click();
  const dialog = page.getByRole('dialog', {
    name: 'Leseeinstellungen',
    exact: true,
  });
  await expect(
    dialog.getByRole('region', { name: 'Persönliche Einstellungen' }),
  ).toBeVisible();
  await dialog
    .getByRole('combobox', { name: 'Darstellungsmodus', exact: true })
    .selectOption('dark');
  await dialog
    .getByRole('combobox', { name: 'Voreinstellung', exact: true })
    .selectOption('ocean');
  await expect(dialog.locator('input')).toHaveCount(0);
  await expect(dialog.locator('option[value=custom]')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(
    dialog.getByRole('button', {
      name: 'Leseeinstellungen schließen',
      exact: true,
    }),
  ).toBeInViewport();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(open).toBeFocused();
  await page.locator('.locale-menu > summary').click();
  await page
    .locator('.locale-menu')
    .getByRole('link', { name: 'English', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Open reader settings', exact: true })
    .click();
  const english = page.getByRole('dialog', {
    name: 'Reader settings',
    exact: true,
  });
  await expect(english.getByRole('combobox')).toHaveCount(3);
  await expect(
    english.getByRole('combobox', { name: 'Preset', exact: true }),
  ).toHaveValue('ocean');
  await expect(
    english.getByRole('combobox', { name: 'Appearance mode', exact: true }),
  ).toHaveValue('dark');
  await expect(english.locator('input')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('localized classic lists retain translated retry states, counts, pagination and endpoint details', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'doctopus:reader-settings:v1:/localized',
      JSON.stringify({ version: 1, layout: 'classic' }),
    ),
  );
  let catalogCalls = 0,
    pageCalls = 0,
    detailCalls = 0;
  await page.route(root + '/api-index/0/catalog.json', (route) =>
    ++catalogCalls === 1
      ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.fulfill({
          json: {
            schemaVersion: 1,
            apiId: 'api',
            version: 'v1',
            total: 101,
            pageSize: 100,
            pages: 2,
          },
        }),
  );
  await page.route(root + '/api-index/0/0.json', (route) =>
    ++pageCalls === 1
      ? route.fulfill({ status: 503, body: 'Unavailable' })
      : route.fulfill({
          json: {
            schemaVersion: 1,
            apiId: 'api',
            version: 'v1',
            page: 0,
            operations: Array.from({ length: 100 }, (_, i) => ({
              slug: `virtual${i}`,
              method: 'get',
              path: `/virtual/${i}`,
              summary: `Virtuell ${i}`,
              tag: 'Testgruppe',
              deprecated: i === 0,
            })),
          },
        }),
  );
  await page.route(root + '/api-index/0/1.json', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        apiId: 'api',
        version: 'v1',
        page: 1,
        operations: [
          {
            slug: 'listprojects',
            method: 'get',
            path: '/projects',
            summary: 'Projekte auflisten',
            tag: 'Projekte',
            deprecated: false,
          },
        ],
      },
    }),
  );
  await page.route(root + '/api/api/v1/virtual0/page-data.json', (route) => {
    detailCalls++;
    return route.fulfill({ status: 503, body: 'Unavailable' });
  });
  await page.goto(root + operation);
  await expect(
    page.getByRole('region', { name: 'API-Endpunktreferenz', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Die Endpunktliste konnte nicht geladen werden.',
  );
  await page
    .getByRole('button', { name: 'Endpunktliste erneut laden', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Diese Endpunktseite konnte nicht geladen werden.',
  );
  await page
    .getByRole('button', { name: 'Endpunktliste erneut laden', exact: true })
    .click();
  await expect(page.locator('.endpoint-disclosure')).toHaveCount(100);
  await expect(page.locator('.classic-pagination')).toContainText(
    'Endpunkte: 101 · Seite 1 von 2',
  );
  const row = page.locator('#classic-0-virtual0');
  await expect(row.locator('summary')).toContainText('Veraltet');
  await row.locator('summary').click();
  await expect(row.getByRole('alert')).toContainText(
    'Die Endpunktdetails konnten nicht geladen werden.',
  );
  await row
    .getByRole('button', { name: 'Endpunktdetails erneut laden', exact: true })
    .click();
  await expect.poll(() => detailCalls).toBe(2);
  await page
    .getByRole('button', { name: 'Nächste Endpunkte', exact: true })
    .click();
  await expect(page.locator('.classic-pagination')).toContainText(
    'Endpunkte: 101 · Seite 2 von 2',
  );
  await page.locator('#classic-1-listprojects > summary').click();
  await expect(
    page.getByRole('link', { name: 'Dauerhafter Endpunktlink', exact: true }),
  ).toHaveAttribute(
    'href',
    '/localized/api/api/v1/listprojects/#classic-1-listprojects',
  );
  await page.getByRole('button', { name: 'Jetzt testen', exact: true }).click();
  await expect(
    page.getByRole('dialog', {
      name: 'Projekte auflisten testen',
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Jetzt testen', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(catalogCalls).toBe(2);
  expect(pageCalls).toBe(2);
  expect(errors).toEqual([]);
});
