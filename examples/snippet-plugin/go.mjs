import { definePlugin } from '@davidniessen/doctopus-plugin-sdk';
import {
  exampleChoices,
  formatExample,
  isJsonMediaType,
} from '@davidniessen/doctopus-contracts';
import { prepareRequest, redactRequest } from '@davidniessen/doctopus-explorer';
import { goSnippet } from './go-code.mjs';

export default definePlugin({
  name: '@davidniessen/example-go-snippets',
  version: '0.1.0',
  pluginApi: '1',
  capabilities: ['snippets'],
  inputs: ['go-code.mjs'],
  generateSnippets({ api, operation }, { signal }) {
    if (signal.aborted) throw new Error('Cancelled');
    if (operation.kind && operation.kind !== 'endpoint') return [];
    const contentType = Object.keys(operation.requestBody?.content ?? {})[0];
    // This first-party example intentionally covers ordinary JSON requests.
    if (contentType && !isJsonMediaType(contentType)) return [];
    const media = operation.requestBody?.content[contentType];
    const parameters = Object.fromEntries(
      operation.parameters.map((parameter) => {
        const content = Object.entries(parameter.content ?? {})[0];
        const value = exampleChoices(content?.[1] ?? parameter, api.schemas)[0]
          .value;
        return [
          `${parameter.in}:${parameter.name}`,
          content
            ? formatExample(value, content[0])
            : typeof value === 'string'
              ? value
              : JSON.stringify(value),
        ];
      }),
    );
    const credentials = Object.fromEntries(
      operation.security
        .flatMap((alternative) => Object.keys(alternative))
        .map((name) => [name, 'YOUR_CREDENTIAL']),
    );
    const request = prepareRequest(operation, api.securitySchemes, {
      server:
        operation.servers[0] ?? api.servers[0] ?? 'https://api.example.com',
      parameters,
      credentials,
      schemas: api.schemas,
      openapiVersion: api.openapiVersion,
      ...(media
        ? {
            contentType,
            body: formatExample(
              exampleChoices(media, api.schemas)[0].value,
              contentType,
            ),
          }
        : {}),
    });
    const safe = redactRequest(
      request,
      credentials,
      media
        ? {
            schema: media.schema,
            schemas: api.schemas,
            openapiVersion: api.openapiVersion,
          }
        : undefined,
    );
    return [
      {
        id: 'go-http',
        label: 'Go net/http',
        language: 'go',
        code: goSnippet(safe),
      },
    ];
  },
});
