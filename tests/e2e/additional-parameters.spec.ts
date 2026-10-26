import { test, expect } from '@playwright/test';
test('only documented query fields are available and clearing optional values removes them from the wire', async ({
  page,
}) => {
  await page.goto('/api/orbit/v1/list-projects/?playground=open');
  const playground = page.getByLabel('API playground', { exact: true });
  await playground
    .getByLabel('bearerAuth credential', { exact: true })
    .fill('demo-token');
  await expect(
    playground.getByRole('button', {
      name: /Add .*parameter|Remove .*parameter/,
    }),
  ).toHaveCount(0);
  await expect(playground.locator('.parameter-presence')).toHaveCount(0);
  const limit = playground.getByLabel('limit parameter', { exact: true });
  await limit.fill('2');
  const first = page.waitForRequest(
    (r) => r.url().includes('/v1/projects?limit=2') && r.method() === 'GET',
  );
  await playground
    .getByRole('button', { name: 'Send request', exact: true })
    .click();
  expect(new URL((await first).url()).searchParams.get('limit')).toBe('2');
  await limit.fill('');
  await playground.getByLabel('cursor parameter', { exact: true }).fill('');
  const next = page.waitForRequest(
    (r) => new URL(r.url()).pathname === '/v1/projects' && r.method() === 'GET',
  );
  await playground
    .getByRole('button', { name: 'Send request', exact: true })
    .click();
  expect(new URL((await next).url()).search).toBe('');
  await expect(
    playground
      .locator('.request-parameter-section')
      .filter({ hasText: 'Headers' }),
  ).toHaveCount(0);
  await expect(
    playground.getByRole('group', { name: 'Request body editor', exact: true }),
  ).toHaveCount(0);
});
