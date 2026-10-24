import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  isImmutableBuilderImage,
  readBuildPolicy,
  readSourceSnapshotInfo,
} from '@davidniessen/doctopus-contracts';
import {
  BuildInputError,
  BuildLeaseLostError,
} from '@davidniessen/doctopus-domain';
import type {
  BuildJobRepository,
  Project,
  Role,
  ProjectBuildCapabilities,
} from '@davidniessen/doctopus-domain';
import { verifyProjectArtifact } from './artifacts.js';

const uuid = z.string().regex(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
const key = z.string().min(1).max(100);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const leaseSeconds = z.number().int().min(10).max(120).optional();
const sourceInput = z
  .object({
    label: z.string().min(1).max(120),
    revision: z.string().min(1).max(200).optional(),
    snapshot: z.unknown(),
    policy: z.unknown(),
    idempotencyKey: key,
  })
  .strict();
const listInput = z.object({ after: uuid.optional() }).strict();
const sourceListInput = listInput
  .extend({
    activeOnly: z.enum(['true', 'false']).optional(),
  })
  .strict();
const enqueueInput = z.object({ sourceId: uuid, idempotencyKey: key }).strict();
const claimInput = z
  .object({
    workerId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/),
    sourceIds: z.array(uuid).min(1).max(1000),
    leaseSeconds,
  })
  .strict();
const heartbeatInput = z.object({ token, leaseSeconds }).strict();
const resultInput = z
  .object({
    artifactId: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.unknown(),
    requestedImage: z.string().max(512).refine(isImmutableBuilderImage),
    resolvedImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    toolVersion: z.string().min(1).max(128),
    durationMs: z.number().int().min(0).max(1020000),
  })
  .strict();
const completeInput = z.object({ token, result: resultInput }).strict();
const failureInput = z
  .object({
    token,
    code: z.enum(['build_failed', 'source_changed', 'deadline_exceeded']),
  })
  .strict();
const emptyInput = z.object({}).strict();
function read<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BuildInputError('Invalid build request');
  return result.data;
}
function approval(input: z.infer<typeof sourceInput>) {
  try {
    return {
      label: input.label,
      ...(input.revision === undefined ? {} : { revision: input.revision }),
      snapshot: readSourceSnapshotInfo(input.snapshot),
      policy: readBuildPolicy(input.policy),
    };
  } catch {
    throw new BuildInputError('Invalid build source approval');
  }
}
type Params = { project: string; source?: string; job?: string };
interface BuildRoutes {
  queue: BuildJobRepository;
  artifactRoot: string;
  needProject: (
    request: FastifyRequest,
    projectId: string,
    role: Role,
    allowPublic?: boolean,
  ) => Promise<Project>;
  requireRoot: (request: FastifyRequest) => void;
  capabilities: (
    request: FastifyRequest,
    project: Project,
  ) => Promise<ProjectBuildCapabilities>;
}
/** No source access or Docker privileges in the HTTP process. */
export function registerBuildJobs(app: FastifyInstance, options: BuildRoutes) {
  const { queue, requireRoot } = options;
  let verifying = 0;
  const project = (request: FastifyRequest<{ Params: Params }>, role: Role) =>
    options.needProject(request, request.params.project, role, false);
  const base = '/api/projects/:project';
  app.get<{ Params: Params }>(base + '/build-capabilities', async (request) => {
    const current = await project(request, 'viewer');
    read(emptyInput, request.query);
    return options.capabilities(request, current);
  });
  app.get<{ Params: Params }>(base + '/build-sources', async (request) => {
    const current = await project(request, 'viewer');
    const query = read(sourceListInput, request.query);
    return queue.sources(current.id, {
      ...(query.after === undefined ? {} : { after: query.after }),
      activeOnly: query.activeOnly === 'true',
    });
  });
  app.get<{ Params: Params }>(
    base + '/build-sources/:source',
    async (request, reply) => {
      const current = await project(request, 'viewer');
      const source = await queue.source(
        current.id,
        read(uuid, request.params.source),
      );
      return (
        source ?? reply.code(404).send({ error: 'Build source not found' })
      );
    },
  );
  app.post<{ Params: Params }>(
    base + '/build-sources',
    async (request, reply) => {
      requireRoot(request);
      const current = await project(request, 'admin');
      const input = read(sourceInput, request.body);
      const source = await queue.approveSource(
        current.id,
        approval(input),
        input.idempotencyKey,
        request.principal!.subject,
      );
      return reply.code(201).send(source);
    },
  );
  app.post<{ Params: Params }>(
    base + '/build-sources/:source/revoke',
    async (request) => {
      const current = await project(request, 'admin');
      read(emptyInput, request.body ?? {});
      return queue.revokeSource(
        current.id,
        read(uuid, request.params.source),
        request.principal!.subject,
      );
    },
  );
  app.get<{ Params: Params }>(base + '/builds', async (request) => {
    const current = await project(request, 'viewer');
    const query = read(listInput, request.query);
    return queue.jobs(current.id, query.after);
  });
  app.get<{ Params: Params }>(base + '/builds/:job', async (request, reply) => {
    const current = await project(request, 'viewer');
    const job = await queue.job(current.id, read(uuid, request.params.job));
    return job ?? reply.code(404).send({ error: 'Build job not found' });
  });
  app.post<{ Params: Params }>(base + '/builds', async (request, reply) => {
    const current = await project(request, 'editor');
    const input = read(enqueueInput, request.body);
    const job = await queue.enqueue(
      current.id,
      input.sourceId,
      input.idempotencyKey,
      request.principal!.subject,
    );
    return reply.code(201).send(job);
  });
  app.post<{ Params: Params }>(
    base + '/builds/:job/cancel',
    async (request) => {
      const current = await project(request, 'editor');
      read(emptyInput, request.body ?? {});
      return queue.cancel(
        current.id,
        read(uuid, request.params.job),
        request.principal!.subject,
      );
    },
  );
  app.post('/api/build-workers/claim', async (request) => {
    requireRoot(request);
    const input = read(claimInput, request.body);
    return {
      lease:
        (await queue.claim(
          input.workerId,
          input.sourceIds,
          input.leaseSeconds,
        )) ?? null,
    };
  });
  app.post<{ Params: Params }>(
    base + '/builds/:job/heartbeat',
    async (request) => {
      requireRoot(request);
      const current = await project(request, 'admin');
      const jobId = read(uuid, request.params.job);
      const input = read(heartbeatInput, request.body);
      if (!(await queue.job(current.id, jobId))) return { owned: false };
      const job = await queue.heartbeat(jobId, input.token, input.leaseSeconds);
      return job ? { owned: true, job } : { owned: false };
    },
  );
  app.post<{ Params: Params }>(
    base + '/builds/:job/complete',
    async (request) => {
      requireRoot(request);
      const current = await project(request, 'admin');
      const jobId = read(uuid, request.params.job);
      const input = read(completeInput, request.body);
      const job = await queue.job(current.id, jobId);
      if (!job) throw new BuildLeaseLostError('Build lease is no longer owned');
      let source;
      try {
        source = readSourceSnapshotInfo(input.result.source);
      } catch {
        throw new BuildInputError('Invalid build result metadata');
      }
      // Completion retries still verify immutable stored bytes. The repository
      // then checks the settled token/metadata without adding another audit row.
      if (verifying >= 2)
        throw Object.assign(new Error('Build verification capacity reached'), {
          statusCode: 503,
        });
      verifying++;
      try {
        await verifyProjectArtifact(
          options.artifactRoot,
          current,
          input.result.artifactId,
          input.result.toolVersion,
        );
        return await queue.complete(jobId, input.token, {
          ...input.result,
          source,
        });
      } finally {
        verifying--;
      }
    },
  );
  app.post<{ Params: Params }>(base + '/builds/:job/fail', async (request) => {
    requireRoot(request);
    const current = await project(request, 'admin');
    const jobId = read(uuid, request.params.job);
    const input = read(failureInput, request.body);
    if (!(await queue.job(current.id, jobId)))
      throw new BuildLeaseLostError('Build lease is no longer owned');
    return queue.fail(jobId, input.token, input.code);
  });
}
