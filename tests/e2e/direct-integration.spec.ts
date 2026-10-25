import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const [adapter, port, source] of [
  ['Express', 4191, '/openapi.yaml'],
  ['Fastify', 4192, '/openapi.json'],
] as const) {
  test(`${adapter} direct setup loads a live specification, branding, search, deep links and the response editor without page-data requests`, async ({
    page,
  }) => {
    const failures: string[] = [];
    const pageData: string[] = [];
    let specLoads = 0;
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === source) specLoads++;
      if (/page-data\.json|search-manifest\.json/.test(request.url()))
        pageData.push(request.url());
    });
    await page.goto(
      `http://127.0.0.1:${port}/docs/${adapter === 'Express' ? 'index.html' : ''}`,
    );
    await expect(page.locator('.brand')).toContainText('Harbor API');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      'API reference for Harbor services.',
    );
    if (adapter === 'Express')
      await expect(
        page.getByRole('heading', { name: 'Say hello', exact: true }),
      ).toBeVisible();
    if (adapter === 'Fastify') {
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(
        page.getByRole('region', { name: 'API endpoint reference' }),
      ).toBeVisible();
    }
    await page
      .getByRole('button', { name: 'Search documentation', exact: true })
      .click();
    const search = page.getByRole('dialog', {
      name: 'Search documentation',
      exact: true,
    });
    await search
      .getByRole('textbox', { name: 'Search documentation', exact: true })
      .fill('Say hello');
    await search
      .getByRole('link')
      .filter({ hasText: 'Say hello' })
      .first()
      .click();
    await expect(page).toHaveURL(/\/docs\/api\/api\/1-0-0\/hello\/$/);
    await page.reload();
    await expect(page.locator('.brand')).toContainText('Harbor API');
    const tryNow = page.getByRole('button', { name: 'Try now', exact: true });
    await tryNow.first().click();
    const playground = page.getByRole('region', {
      name: 'API playground',
      exact: true,
    });
    await playground
      .getByRole('button', { name: 'Send request', exact: true })
      .click();
    await expect(playground.locator('.response-meta')).toContainText('200');
    await expect(
      playground.locator('.monaco-editor .view-lines'),
    ).toContainText(`Hello from ${adapter}`);
    expect(pageData).toEqual([]);
    expect(failures).toEqual([]);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(specLoads).toBeGreaterThanOrEqual(2);
  });
}
test('direct specification failures support retry and delayed loading uses skeletons', async ({
  page,
}) => {
  let failures = 1;
  await page.route('http://127.0.0.1:4191/openapi.yaml', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (failures-- > 0)
      await route.fulfill({ status: 503, body: 'unavailable' });
    else await route.continue();
  });
  await page.goto('http://127.0.0.1:4191/docs/');
  await expect(page.locator('.article-skeleton')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('specification URL');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.brand')).toContainText('Harbor API');
});

test('minimal integration uses the specification title and accepts an index.html landing page', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4191/reference/index.html');
  await expect(page.locator('.brand')).toContainText('Source API');
  await expect(
    page.getByRole('heading', { name: 'Say hello', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Page not found', exact: true }),
  ).toHaveCount(0);
});
