import { expect, type Locator, type Page } from '@playwright/test';

export async function addParameter(
  playground: Locator,
  location: 'query' | 'header',
) {
  const section = playground
    .locator('.request-parameter-section')
    .filter({ hasText: location === 'query' ? 'Query parameters' : 'Headers' });
  if (
    !(await section.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await section.locator('summary').click();
  await section
    .getByRole('button', { name: `Add ${location} parameter`, exact: true })
    .click();
}

export async function expandBodyFields(playground: Locator) {
  const button = playground.getByRole('button', {
    name: /^Expand \d+ optional fields?$/,
  });
  if (await button.count()) await button.click();
}

export async function addBodyField(playground: Locator) {
  await playground
    .getByRole('button', { name: 'Add body field', exact: true })
    .click();
  return playground.locator('.body-form .request-custom-field:visible').last();
}

export async function openRequestSettings(playground: Locator) {
  const section = playground.locator('.request-settings');
  if (
    !(await section.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await section.locator('summary').click();
}

export async function openSchemaControls(playground: Locator) {
  await playground
    .getByRole('group', { name: 'Request body editor', exact: true })
    .getByRole('button', { name: 'Form', exact: true })
    .click();
  const section = playground.locator('.body-schema-fields');
  if (
    !(await section.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await section.locator('summary').click();
}

/** Simulate a changed published specification without exposing a destination editor in the UI. */
export async function changePublishedServer(
  page: Page,
  playground: Locator,
  server: string,
) {
  const path = new URL(page.url()).pathname;
  await playground
    .getByRole('button', { name: 'Close playground', exact: true })
    .click();
  const pageDataUrl = new URL(path + 'page-data.json', page.url()).href;
  await page.route(
    pageDataUrl,
    async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      for (const api of data.apis)
        for (const operation of api.operations) operation.servers = [server];
      await route.fulfill({ response, json: data });
    },
    { times: 1 },
  );
  const navigationResponse = page.waitForResponse(
    (response) =>
      response.url() === pageDataUrl && response.request().method() === 'GET',
  );
  await page.locator(`a[data-doc-route][href="${path}"]`).first().click();
  await (await navigationResponse).finished();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Try now', exact: true }).click();
  await expect(playground).toBeVisible();
}
