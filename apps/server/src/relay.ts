import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  requestAllowedOrigin,
  OutboundRequestError,
} from '@davidniessen/doctopus-spec';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import type {
  Project,
  RelayAuditWriter,
  Role,
  RelayAudit,
} from '@davidniessen/doctopus-domain';
import type { RelayPolicy } from './relay-policy.js';
import { relayDestination } from './relay-policy.js';
import { z } from 'zod';
import { RelayLeases } from './relay-leases.js';
import type { RelayLease } from './relay-leases.js';

interface RelayBody {
  url: string;
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
  headers: [string, string][];
  bodyBase64?: string;
}
export const RELAY_PATH = '/api/projects/:project/relay';
type Params = { project: string };
function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
const responseHeaders = new Set([
  'content-type',
  'content-language',
  'cache-control',
  'etag',
  'last-modified',
  'retry-after',
  'www-authenticate',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
]);
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Relay cancelled or timed out'));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

/** No routes exist unless the operator supplied a fully validated policy. */
export async function registerRelay(
  app: FastifyInstance,
  repository: RelayAuditWriter,
  policy: RelayPolicy,
  authorize: (
    request: FastifyRequest,
    project: string,
    role: Role,
  ) => Promise<Project>,
) {
  const checked = new WeakMap<FastifyRequest, Project>();
  const leases = new RelayLeases(policy);
  const jobs = new WeakMap<FastifyRequest, RelayLease>();
  const pendingAudit = new Set<Promise<void>>();
  const guard = async (
    request: FastifyRequest<{ Params: Params }>,
    reply: FastifyReply,
  ) => {
    let project = await authorize(request, request.params.project, 'viewer');
    const rule = Object.hasOwn(policy.projects, project.slug)
      ? policy.projects[project.slug]
      : undefined;
    if (!rule) fail(404, 'The relay is not configured for this project');
    if (rule.minimumRole !== 'viewer')
      project = await authorize(request, project.id, rule.minimumRole);
    checked.set(request, project);
    if (request.method === 'POST')
      jobs.set(
        request,
        leases.reserve(
          request,
          reply,
          project.id + ':' + request.principal!.subject,
        ),
      );
  };
  const requestSchema = z
    .object({
      url: z.string().min(1).max(4096),
      method: z.enum([
        'GET',
        'HEAD',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
      ]),
      headers: z
        .array(z.tuple([z.string().max(128), z.string().max(16 * 1024)]))
        .max(64),
      bodyBase64: z
        .string()
        .max(Math.ceil(policy.maxRequestBytes / 3) * 4)
        .optional(),
    })
    .strict();
  app.addHook('preClose', async () => {
    leases.stop();
  });
  app.addHook('onClose', async () => {
    await Promise.allSettled([...pendingAudit]);
  });
  app.get<{ Params: Params }>(
    RELAY_PATH,
    { onRequest: guard },
    async (request) => {
      const project = checked.get(request)!;
      const projectPolicy = policy.projects[project.slug]!;
      return {
        schemaVersion: 1,
        project: project.slug,
        maxRequestBytes: policy.maxRequestBytes,
        maxResponseBytes: policy.maxResponseBytes,
        timeoutMs: policy.timeoutMs,
        requestHeaders: projectPolicy.requestHeaders,
        destinations: projectPolicy.destinations.map(
          ({ origin, pathPrefix, methods }) => ({
            origin,
            pathPrefix,
            methods,
          }),
        ),
      };
    },
  );
  app.post<{ Params: Params; Body: RelayBody }>(
    RELAY_PATH,
    {
      onRequest: guard,
      bodyLimit: Math.ceil(policy.maxRequestBytes / 3) * 4 + 64 * 1024,
      preValidation: async (request) => {
        if (!requestSchema.safeParse(request.body).success)
          fail(400, 'Invalid relay request fields or limits');
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'method', 'headers'],
          properties: {
            url: { type: 'string', minLength: 1, maxLength: 4096 },
            method: {
              type: 'string',
              enum: [
                'GET',
                'HEAD',
                'POST',
                'PUT',
                'PATCH',
                'DELETE',
                'OPTIONS',
              ],
            },
            headers: {
              type: 'array',
              maxItems: 64,
              items: {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: { type: 'string', maxLength: 16 * 1024 },
              },
            },
            bodyBase64: {
              type: 'string',
              maxLength: Math.ceil(policy.maxRequestBytes / 3) * 4,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const project = checked.get(request)!,
        projectPolicy = policy.projects[project.slug]!;
      const actor = request.principal!.subject;
      const lease = jobs.get(request)!;
      lease.begin();
      try {
        const { controller, requestId, started } = lease;
        if (controller.signal.aborted)
          fail(504, 'Relay cancelled or timed out');
        const base = { requestId, method: request.body.method };
        reply.header('X-Api-Docs-Relay-Id', requestId);
        const audit = (event: RelayAudit) => {
          const pending = abortable(
            Promise.resolve().then(() =>
              repository.recordRelay(project.id, actor, event),
            ),
            AbortSignal.timeout(5000),
          );
          pendingAudit.add(pending);
          lease.hold(pending);
          const settled = () => {
            pendingAudit.delete(pending);
          };
          void pending.then(settled, settled);
          return pending;
        };
        let destination: ReturnType<typeof relayDestination>;
        let headers: Record<string, string>, body: Buffer | undefined;
        try {
          destination = relayDestination(
            projectPolicy,
            request.body.url,
            request.body.method,
          );
          headers = Object.create(null) as Record<string, string>;
          let size = 0;
          const allowed = new Set(
            projectPolicy.requestHeaders.map((name) => name.toLowerCase()),
          );
          for (const [name, value] of request.body.headers) {
            const key = name.toLowerCase();
            if (
              !allowed.has(key) ||
              Object.hasOwn(headers, key) ||
              Array.from(value).some((char) => {
                const code = char.charCodeAt(0);
                return code > 255 || code === 127 || (code < 32 && code !== 9);
              })
            )
              throw new Error('Relay header policy rejected this request');
            size += name.length + value.length + 4;
            if (size > 15 * 1024)
              throw new Error('Relay request headers exceed their budget');
            headers[key] = value;
          }
          if (request.body.bodyBase64 !== undefined) {
            const encoded = request.body.bodyBase64;
            if (
              encoded.length % 4 !== 0 ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
            )
              throw new Error('Invalid relay body encoding');
            body = Buffer.from(encoded, 'base64');
            if (
              body.length > policy.maxRequestBytes ||
              body.toString('base64') !== encoded
            )
              throw new Error('Invalid or excessive relay body');
          }
          if (['GET', 'HEAD'].includes(request.body.method) && body?.length)
            throw new Error('This method cannot carry a relay request body');
        } catch {
          await abortable(
            audit({ ...base, phase: 'denied', outcome: 'request-policy' }),
            controller.signal,
          );
          fail(
            403,
            'The relay destination, method, headers or body are not allowed',
          );
        }
        let began = false,
          status: number | undefined,
          responseBytes: number | undefined;
        const metadata = {
          ...base,
          origin: destination.url.origin,
          requestBytes: body?.length ?? 0,
        };
        try {
          controller.signal.throwIfAborted();
          await abortable(
            audit({ ...metadata, phase: 'started' }),
            controller.signal,
          );
          began = true;
          controller.signal.throwIfAborted();
          const result = await requestAllowedOrigin(destination.url.href, {
            allowedOrigins: [destination.rule.origin],
            allowHttp: destination.rule.allowHttp,
            allowPrivateNetwork: destination.rule.allowPrivateNetwork,
            method: request.body.method,
            headers: { ...headers, 'user-agent': 'doctopus/' + toolVersion },
            ...(body !== undefined ? { body } : {}),
            maxRequestBytes: policy.maxRequestBytes,
            maxBytes: policy.maxResponseBytes,
            timeoutMs: policy.timeoutMs,
            signal: controller.signal,
          });
          status = result.status;
          responseBytes = result.body.length;
          if ([301, 302, 303, 305, 307, 308].includes(status))
            fail(502, 'Relay redirects are not followed');
          const returned = Object.fromEntries(
            Object.entries(result.headers).filter(
              ([name, value]) =>
                responseHeaders.has(name) && typeof value === 'string',
            ),
          );
          await abortable(
            audit({
              ...metadata,
              phase: 'completed',
              status,
              responseBytes,
              durationMs: Date.now() - started,
              outcome: 'response',
            }),
            controller.signal,
          );
          controller.signal.throwIfAborted();
          return {
            schemaVersion: 1,
            status,
            headers: returned,
            bodyBase64: result.body.toString('base64'),
          };
        } catch (error) {
          if (began) {
            const event: RelayAudit = {
              ...metadata,
              phase: 'failed',
              ...(status !== undefined ? { status } : {}),
              ...(responseBytes !== undefined ? { responseBytes } : {}),
              durationMs: Date.now() - started,
              outcome: controller.signal.aborted
                ? 'cancelled'
                : error instanceof OutboundRequestError
                  ? error.code
                  : 'relay-failed',
            };
            void audit(event).catch(() => {
              app.log.warn(
                { type: 'RelayAuditFailure' },
                'Relay outcome audit could not be recorded',
              );
            });
          }
          if (
            status !== undefined &&
            [301, 302, 303, 305, 307, 308].includes(status)
          )
            fail(502, 'Relay redirects are not followed');
          fail(
            controller.signal.aborted ? 504 : 502,
            controller.signal.aborted
              ? 'Relay cancelled or timed out; no automatic retry was made'
              : 'Relay could not complete the request; no automatic retry was made',
          );
        }
      } finally {
        lease.end();
      }
    },
  );
}
