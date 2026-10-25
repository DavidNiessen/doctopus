import express from 'express';
import Fastify from 'fastify';
import { stringify } from 'yaml';
import { createExpressDocs } from '@davidniessen/doctopus-node/express';
import { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';
const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Source API',
    version: '1.0.0',
  },
  servers: [
    {
      url: '/',
    },
  ],
  paths: {
    '/api/hello': {
      get: {
        operationId: 'hello',
        summary: 'Say hello',
        tags: ['Greetings'],
        responses: {
          200: {
            description: 'A greeting',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/goodbye': {
      get: {
        operationId: 'goodbye',
        summary: 'Say goodbye',
        tags: ['Greetings'],
        responses: {
          200: {
            description: 'Goodbye',
          },
        },
      },
    },
  },
};
const app = express();
app.get('/openapi.yaml', (_request, response) =>
  response.type('application/yaml').send(stringify(spec)),
);
app.get('/api/hello', (_request, response) =>
  response.json({ message: 'Hello from Express' }),
);
const docs = await createExpressDocs({
  url: '/openapi.yaml',
  title: 'Harbor API',
  description: 'API reference for Harbor services.',
  theme: 'ocean',
});
app.use(docs.mountPath, docs.router);
const defaults = await createExpressDocs({
  url: '/openapi.yaml',
  mountPath: '/reference',
});
app.use(defaults.mountPath, defaults.router);
const expressServer = app.listen(4191, '127.0.0.1');
await new Promise((resolve) => expressServer.once('listening', resolve));
const fastify = Fastify();
fastify.get('/openapi.json', async () => spec);
fastify.get('/api/hello', async () => ({ message: 'Hello from Fastify' }));
await fastify.register(doctopusPlugin, {
  url: '/openapi.json',
  title: 'Harbor API',
  description: 'API reference for Harbor services.',
  theme: 'violet',
  layout: 'classic',
  appearance: 'dark',
});
await fastify.listen({ port: 4192, host: '127.0.0.1' });
app.get('/health/ready', (_request, response) => response.send('ready'));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await fastify.close();
    expressServer.closeAllConnections();
    expressServer.close();
  });
