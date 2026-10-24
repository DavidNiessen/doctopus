import type { FastifyPluginAsync, onRequestHookHandler } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ipKeyGenerator } from 'express-rate-limit';
import { headers, prepare } from './shared.js';
import { DocumentationRateLimiter, rateLimitMessage } from './rate-limit.js';
import type { DocumentationRateLimitOptions } from './rate-limit.js';
export type { DocumentationRateLimitOptions } from './rate-limit.js';
export interface FastifyDocsOptions {
  directory: string;
  mountPath?: string;
  authenticate?: onRequestHookHandler;
  rateLimit?: DocumentationRateLimitOptions;
}
export const doctopusPlugin: FastifyPluginAsync<FastifyDocsOptions> = async (
  app,
  options,
) => {
  const limiter = new DocumentationRateLimiter(options.rateLimit);
  const { root, basePath, allowsPath, hasNotFoundPage } = await prepare(
    options.directory,
    options.mountPath,
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
