import { readFile } from 'node:fs/promises';
import { definePlugin } from '@davidniessen/doctopus-plugin-sdk';
import {
  parseJsonValue,
  serializeJsonValue,
  setJsonProperty,
} from '@davidniessen/doctopus-contracts';

// Review this file and deployment.json before enabling --trust-plugins.
// This example uses the bounded lossless JSON editor: 1 MiB, 32 levels, 10k values.
export default definePlugin({
  name: '@davidniessen/example-deployment-source',
  version: '0.1.0',
  pluginApi: '1',
  capabilities: ['source'],
  inputs: ['deployment.json'],
  async loadSpec(source, { signal, diagnostic }) {
    if (!source.path.endsWith('.json')) return source.content;
    const document = parseJsonValue(source.content);
    if (document.kind !== 'object')
      throw new Error('Expected an OpenAPI object');
    const deployment = JSON.parse(
      await readFile('deployment.json', { encoding: 'utf8', signal }),
    );
    const servers = parseJsonValue(JSON.stringify(deployment.servers));
    diagnostic({
      code: 'deployment-source',
      severity: 'warning',
      message: 'Applied the reviewed deployment server list.',
      source: source.path,
    });
    return serializeJsonValue(
      setJsonProperty(document, 'servers', servers),
      true,
    );
  },
});
