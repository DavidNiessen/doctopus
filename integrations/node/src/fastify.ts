import type { FastifyPluginAsync, onRequestHookHandler } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ipKeyGenerator } from 'express-rate-limit';
import { headers, prepare } from './shared.js';
import { DocumentationRateLimiter, rateLimitMessage } from './rate-limit.js';
import type { DocumentationRateLimitOptions } from './rate-limit.js';
import { isDirectDocumentationRoute } from '@davidniessen/doctopus-contracts';
import type { DocumentationOptions } from './shared.js';
export type { DocumentationRateLimitOptions } from './rate-limit.js';
export interface FastifyDocsOptions extends DocumentationOptions {
  authenticate?: onRequestHookHandler;
  rateLimit?: DocumentationRateLimitOptions;
}
export const doctopusPlugin: FastifyPluginAsync<FastifyDocsOptions> = async (
  app,
  options,
) => {
  const limiter = new DocumentationRateLimiter(options.rateLimit);
  const { root, basePath, allowsPath, hasNotFoundPage, html } = await prepare(
    options.directory === undefined
      ? {
          ...options,
          publicBasePath:
            options.publicBasePath ??
            app.prefix +
              (options.mountPath === '/' ? '' : (options.mountPath ?? '/docs')),
        }
      : options,
  );
  app.addHook('onRequest', async (request, reply) => {
    const state = limiter.increment(ipKeyGenerator(request.ip));
    if (state.totalHits > limiter.maxRequests)
      return reply
        .code(429)
        .header(
          'Retry-After',
          String(
            Math.max(
              1,
              Math.ceil((state.resetTime.getTime() - Date.now()) / 1000),
            ),
          ),
        )
        .type('text/plain')
        .send(rateLimitMessage);
  });
  if (options.authenticate) app.addHook('onRequest', options.authenticate);
  app.addHook('onSend', async (_request, reply) => {
    for (const [key, value] of Object.entries(headers))
      reply.header(key, value);
    if (reply.statusCode === 429) reply.header('Cache-Control', 'no-store');
  });
  if (html) {
    await app.register(fastifyStatic, { root, serve: false, dotfiles: 'deny' });
    const handler: import('fastify').RouteHandlerMethod = async (
      request,
      reply,
    ) => {
      let path: string;
      try {
        path = decodeURIComponent(
          new URL(request.url, 'http://localhost').pathname.slice(
            (app.prefix + basePath).length,
          ),
        );
      } catch {
        return reply.code(404).type('text/plain').send('Not found');
      }
      if (isDirectDocumentationRoute(path))
        return reply.type('text/html').send(html);
      if (!allowsPath(path))
        return reply.code(404).type('text/plain').send('Not found');
      return reply.sendFile(path.replace(/^\//, ''));
    };
    if (basePath)
      app.route({ method: ['GET', 'HEAD'], url: basePath, handler });
    app.route({ method: ['GET', 'HEAD'], url: `${basePath}/*`, handler });
    return;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: `${basePath}/`,
    index: ['index.html'],
    dotfiles: 'deny',
    maxAge: 0,
    redirect: true,
    allowedPath: (pathname) => allowsPath(pathname),
  });
  app.setNotFoundHandler((_request, reply) => {
    reply.code(404);
    return hasNotFoundPage
      ? reply.sendFile('404.html')
      : reply.type('text/plain').send('Not found');
  });
};
