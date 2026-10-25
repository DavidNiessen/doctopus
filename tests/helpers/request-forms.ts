import type { Locator } from '@playwright/test';

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
