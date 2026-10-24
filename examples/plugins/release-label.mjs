import { definePlugin } from '@davidniessen/doctopus-plugin-sdk';
import { releaseLabel } from './label.mjs';
export default definePlugin({
  name: '@davidniessen/example-release-label',
  version: '0.1.0',
  pluginApi: '1',
  capabilities: ['transform'],
  inputs: ['label.mjs'],
  transform(site, context) {
    if (context.signal.aborted) throw new Error('Build cancelled');
    site.config.name = releaseLabel;
    context.diagnostic({
      code: 'example-release-label',
      severity: 'warning',
      message: 'The example plugin applied its configured release label.',
    });
    return site;
  },
});
