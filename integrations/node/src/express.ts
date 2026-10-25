import express from 'express';
import type { RequestHandler, Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { headers, prepare } from './shared.js';
import { DocumentationRateLimiter, rateLimitMessage } from './rate-limit.js';
import { isDirectDocumentationRoute } from '@davidniessen/doctopus-contracts';
import type { DocumentationOptions } from './shared.js';
import type { DocumentationRateLimitOptions } from './rate-limit.js';
export type { DocumentationRateLimitOptions } from './rate-limit.js';
export interface ExpressDocsOptions extends DocumentationOptions {
  authenticate?: RequestHandler;
  rateLimit?: DocumentationRateLimitOptions;
}
export async function createExpressDocs(
  options: ExpressDocsOptions = {},
): Promise<{ router: Router; mountPath: string; root: string }> {
  const limiter = new DocumentationRateLimiter(options.rateLimit);
  const { root, basePath, allowsPath, hasNotFoundPage, html } =
    await prepare(options);
  const router = express.Router();
  router.use(
    rateLimit({
      windowMs: limiter.windowMs,
      limit: limiter.maxRequests,
      store: limiter,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.status(429).type('text/plain').send(rateLimitMessage);
      },
    }),
  );
  if (options.authenticate) router.use(options.authenticate);
  router.use((_request, response, next) => {
    for (const [key, value] of Object.entries(headers))
      response.setHeader(key, value);
    next();
  });
  const notFound: RequestHandler = (_request, response) => {
    response.status(404);
    if (hasNotFoundPage) response.sendFile('404.html', { root });
    else response.type('text/plain').send('Not found');
  };
  router.use((request, response, next) => {
    let path: string;
    try {
      path = decodeURIComponent(request.path);
    } catch {
      return notFound(request, response, next);
    }
    if (
      html &&
      ['GET', 'HEAD'].includes(request.method) &&
      isDirectDocumentationRoute(path)
    ) {
      response.type('html').send(html);
      return;
    }
    if (!allowsPath(path)) return notFound(request, response, next);
    next();
  });
  router.use(
    express.static(root, {
      dotfiles: 'deny',
      etag: true,
      maxAge: 0,
      redirect: true,
      fallthrough: true,
    }),
  );
  router.use(notFound);
  return { router, mountPath: basePath || '/', root };
}
