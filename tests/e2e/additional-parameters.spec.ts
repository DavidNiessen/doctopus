import { addParameter } from '../helpers/request-forms.js';
import { test, expect } from '@playwright/test';

// Inspect real browser requests to the local API, including CORS preflight.
test('custom query/header form fields reach the actual API and deleted or disabled fields do not', async ({
  page,
}) => {
  await page.goto('/api/orbit/v1/list-projects/?playground=open');
  const playground = page.getByLabel('API playground', { exact: true });
  await playground
    .getByLabel('bearerAuth credential', { exact: true })
    .fill('demo-token');
  await addParameter(playground, 'query');
  await playground
    .getByLabel('query parameter name 1', { exact: true })
    .fill('tag');
  await playground
    .getByLabel('query parameter value 1', { exact: true })
    .fill('blue & violet');
  await addParameter(playground, 'query');
  await playground
    .getByLabel('query parameter name 2', { exact: true })
    .fill('tag');
  await playground
    .getByLabel('query parameter value 2', { exact: true })
    .fill('');
  await addParameter(playground, 'header');
  await playground
    .getByLabel('header parameter name 1', { exact: true })
    .fill('trace');
  await playground
    .getByLabel('header parameter value 1', { exact: true })
    .fill('custom-trace');
  const sent = page.waitForRequest(
    (request) =>
      request.url().includes('/v1/projects?') && request.method() === 'GET',
  );
  const response = page.waitForResponse(
    (item) =>
      item.url().includes('/v1/projects?') && item.request().method() === 'GET',
  );
  await playground
    .getByRole('button', { name: 'Send request', exact: true })
    .click();
  const request = await sent;
  expect(new URL(request.url()).searchParams.getAll('tag')).toEqual([
    'blue & violet',
    '',
  ]);
  expect(request.headers().trace).toBe('custom-trace');
  expect((await response).status()).toBe(200);
  await playground
    .getByLabel('Include additional header parameter 1', { exact: true })
    .uncheck();
  await playground
    .getByRole('button', {
      name: 'Remove additional query parameter 1',
      exact: true,
    })
    .click();
  const next = page.waitForRequest(
    (item) =>
      item.url().includes('/v1/projects?tag=') && item.method() === 'GET',
  );
  await playground
    .getByRole('button', { name: 'Send request', exact: true })
    .click();
  const updated = await next;
  expect(new URL(updated.url()).searchParams.getAll('tag')).toEqual(['']);
  expect(updated.headers().trace).toBeUndefined();
});
