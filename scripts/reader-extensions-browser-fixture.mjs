import { buildSite, createStaticServer } from '@davidniessen/doctopus-cli';
const built = await buildSite(
  new URL('../examples/reader-extensions/', import.meta.url).pathname,
  { trustPlugins: true },
);
const server = await createStaticServer(built.directory);
await server.listen({ host: '127.0.0.1', port: 4178 });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => void server.close());
