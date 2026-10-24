import { expect, it } from 'vitest';
import { parseConfig } from '@davidniessen/doctopus-spec';
const config = { name: 'Demo', specs: [{ id: 'api', path: 'openapi.yaml' }] };
it('keeps existing playgrounds live by default and accepts explicit live/mock modes', () => {
  expect(parseConfig(config).explorer).toBeUndefined();
  for (const mode of ['live', 'mock'])
    expect(parseConfig({ ...config, explorer: { mode } }).explorer?.mode).toBe(
      mode,
    );
});
it('rejects unknown modes instead of silently activating live traffic', () => {
  for (const mode of ['offline', '', false, null])
    expect(() => parseConfig({ ...config, explorer: { mode } })).toThrow();
});
