import { test, expect } from '@playwright/test';
import type { SiteData } from '@davidniessen/doctopus-contracts';

test('reader navigation sanitizes guide HTML and executable links from page data', async ({
  page,
}) => {
  await page.route('**/guides/quickstart/page-data.json', async (route) => {
    const response = await route.fetch();
    const data = (await response.json()) as SiteData;
    const guide = data.guides.find((guide) => guide.slug === 'quickstart');
    if (!guide) throw new Error('Missing quickstart guide fixture');
    guide.html =
      '<h2 id="heading-safe">Safe response content</h2><img src="/xss-test-missing" onerror="window.__doctopusXss=1"><script>window.__doctopusXss=2</script><svg onload="window.__doctopusXss=3"></svg><a href="javascript:window.__doctopusXss=4">Unsafe guide link</a><style>body{display:none}</style>';
    data.config.links = [
      {
        label: 'Unsafe navigation link',
        href: 'javascript:window.__doctopusXss=5',
      },
    ];
    await route.fulfill({ response, json: data });
  });
  await page.goto('/');
  await page
    .getByRole('link', { name: 'Quickstart', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Safe response content' }),
  ).toBeVisible();
  const guide = page.locator('.guide-content');
  await expect(guide.locator('script, svg, style')).toHaveCount(0);
  expect(await guide.locator('img').getAttribute('onerror')).toBeNull();
  expect(await guide.locator('a').getAttribute('href')).toBeNull();
  const navigation = page.getByRole('link', {
    name: 'Unsafe navigation link',
    exact: true,
  });
  await expect(navigation).toHaveAttribute('href', '#');
  await navigation.click();
  expect(
    await page.evaluate(() => Object.hasOwn(window, '__doctopusXss')),
  ).toBe(false);
});
