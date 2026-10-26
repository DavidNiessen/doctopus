import { expect, type Locator, type Page } from '@playwright/test';

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
  // The native toggle event updates React after the summary click completes.
  // Wait for the schema fields so callers cannot target the outgoing form.
  await expect(
    section.getByRole('group', { name: 'Request fields', exact: true }),
  ).toBeVisible();
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

export async function clearBodyField(playground: Locator, name: string) {
  const control = playground.getByLabel(`Body ${name}`, { exact: true });
  if (!(await control.isVisible())) {
    const json = playground.getByRole('button', {
      name: `Edit body ${name} as JSON`,
      exact: true,
    });
    if (await json.count()) await json.click();
  }
  if (await control.evaluate((element) => element.tagName === 'SELECT'))
    await control.selectOption('');
  else await control.fill('');
}

export async function enterBodyField(playground: Locator, name: string) {
  const fixed = playground.getByRole('button', {
    name: `Use fixed value for body ${name}`,
    exact: true,
  });
  if (await fixed.count()) {
    await fixed.click();
    return;
  }
  const control = playground.getByLabel(`Body ${name}`, { exact: true });
  if (await control.evaluate((element) => element.tagName === 'SELECT')) {
    await control.selectOption('false');
    return;
  }
  const group = control.locator(
    'xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," body-field ")][1]',
  );
  const type = await group.locator('.body-field-heading small').textContent();
  const value = type?.match(/object|JSON/)
    ? '{}'
    : type?.includes('array')
      ? '[]'
      : type?.match(/integer|number/)
        ? '0'
        : 'example';
  await control.fill(value);
}
