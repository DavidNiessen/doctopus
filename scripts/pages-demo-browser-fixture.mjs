import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';

const root = new URL('../.doctopus/pages-demo/', import.meta.url).pathname;
const manifest = await verifyArtifact(root);
const site = JSON.parse(await readFile(join(root, 'site.json'), 'utf8'));
if (site.config.explorer?.mode !== 'mock')
  throw new Error('Expected mock-only demo');
const base = site.config.basePath;
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
};
// Plain files and directory indexes only, matching Pages: no SPA fallback or API routes.
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method !== 'GET' || !url.pathname.startsWith(base + '/')) {
      response.writeHead(404).end();
      return;
    }
    let path = decodeURIComponent(url.pathname.slice(base.length + 1));
    if (!path || path.endsWith('/')) path += 'index.html';
    if (!Object.hasOwn(manifest.files, path)) {
      response.writeHead(404).end();
      return;
    }
    const body = await readFile(join(root, path));
    response.writeHead(200, {
      'content-type':
        (types[extname(path)] ?? 'application/octet-stream') +
        '; charset=utf-8',
    });
    response.end(body);
  } catch {
    response.writeHead(500).end();
  }
});
server.listen(4180, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => server.close());
