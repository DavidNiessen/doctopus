import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const root = 'http://127.0.0.1:4176/reference';
test('deprecations paginate and filter complete static inventories with working migration links', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2027-05-15T12:00:00Z'));
  await page.goto(root + '/guides/migration/');
  await page.getByRole('link', { name: 'Deprecations', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Deprecations', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.lifecycle-card')).toHaveCount(50);
  await expect(
    page.getByText('Status as of 2027-05-15', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Sunset date reached', { exact: true }),
  ).toHaveCount(1);
  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  await expect(page).toHaveURL(root + '/deprecations/page/2/');
  await expect(page.locator('.lifecycle-card')).toHaveCount(6);
  await expect(
    page.getByRole('link', { name: 'Next page', exact: true }),
  ).toHaveCount(0);
  await page.getByText('Choose API and version', { exact: true }).click();
  await page
    .getByRole('link', { name: 'Catalog API · v2 1', exact: true })
    .click();
  await expect(page).toHaveURL(root + '/deprecations/api/catalog/version/v2/');
  await expect(page.locator('.lifecycle-card')).toHaveCount(1);
  await expect(page.locator('.lifecycle-status')).toHaveText(
    'Lifecycle announcement',
  );
  await page
    .getByRole('link', { name: 'Migration guide', exact: true })
    .click();
  await expect(page).toHaveURL(
    root + '/guides/migration/#heading-update-your-client',
  );
  await expect(page.locator('#heading-update-your-client')).toBeInViewport();
  await page.goBack();
  await expect(page.locator('.lifecycle-card')).toHaveCount(1);
  await page.goto(root + '/api/catalog/v1/listwidgets/');
  const notice = page.getByRole('complementary', {
    name: 'Operation lifecycle',
  });
  await expect(
    notice.getByText('Sunset within 30 days', { exact: true }),
  ).toBeVisible();
  await expect(notice.getByText('2027-06-01', { exact: true })).toBeVisible();
  await notice
    .getByRole('link', { name: 'Replacement operation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'List widgets', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Operation lifecycle' }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the center is accessible in both themes and narrow layouts and retains no-JavaScript pagination', async ({
  page,
  browser,
}) => {
  await page.goto(root + '/deprecations/');
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark')
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.doctopus/lifecycle-center.png' });
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const plain = await context.newPage();
    await plain.goto(root + '/deprecations/');
    await expect(plain.locator('.lifecycle-card')).toHaveCount(50);
    await plain.getByRole('link', { name: 'Next page', exact: true }).click();
    await expect(plain.locator('.lifecycle-card')).toHaveCount(6);
    await plain.getByText('Choose API and version', { exact: true }).click();
    await plain
      .getByRole('link', { name: 'Catalog API · v1 55', exact: true })
      .click();
    await expect(plain).toHaveURL(
      root + '/deprecations/api/catalog/version/v1/',
    );
    await expect(plain.locator('.lifecycle-card')).toHaveCount(50);
    await plain.getByRole('link', { name: 'Next page', exact: true }).click();
    await expect(plain.locator('.lifecycle-card')).toHaveCount(5);
    expect((await plain.goto(root + '/deprecations/page/999/'))?.status()).toBe(
      404,
    );
  } finally {
    await context.close();
  }
});
