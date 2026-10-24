import { buildSite, createStaticServer } from '@davidniessen/doctopus-cli';
const built = await buildSite(
  new URL('../examples/localized/', import.meta.url).pathname,
);
const server = await createStaticServer(built.directory);
await server.listen({ host: '127.0.0.1', port: 4177 });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => void server.close());
