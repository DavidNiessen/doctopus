import { readFile } from 'node:fs/promises';
import { definePlugin } from '@davidniessen/doctopus-plugin-sdk';

export default definePlugin({
  name: '@davidniessen/example-brand-theme',
  version: '0.1.0',
  pluginApi: '1',
  capabilities: ['theme'],
  inputs: ['brand.json'],
  async theme(_current, { signal, diagnostic }) {
    const brand = JSON.parse(
      await readFile('brand.json', { encoding: 'utf8', signal }),
    );
    diagnostic({
      code: 'example-brand-theme',
      severity: 'warning',
      message: 'Applied the reviewed brand token file.',
    });
    return {
      accent: brand.accent,
      radius: brand.radius,
      colors: { light: { surface: brand.surface } },
    };
  },
});
