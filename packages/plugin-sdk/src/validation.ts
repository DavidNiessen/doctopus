import { z } from 'zod';
import type { SiteData } from '@davidniessen/doctopus-contracts';
import {
  validateGuideTranslations,
  lifecycleIssues,
} from '@davidniessen/doctopus-contracts';
import type { OperationLifecycle } from '@davidniessen/doctopus-contracts';
const text = z.string().max(2 * 1024 * 1024);
const name = z.string().min(1).max(1024);
const object = z.record(z.string(), z.unknown());
const media = z
  .object({
    schema: object,
    encoding: object.optional(),
    example: z.unknown().optional(),
    examples: object.optional(),
  })
  .strict();
const content = z.record(z.string(), media);
const codeSamples = z
  .array(
    z
      .object({
        plugin: name.regex(
          /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/,
        ),
        id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        label: z.string().min(1).max(40),
        language: z.string().regex(/^[a-zA-Z][a-zA-Z0-9+#._-]{0,39}$/),
        code: z
          .string()
          .min(1)
          .max(256 * 1024)
          .refine((code) => Buffer.byteLength(code) <= 256 * 1024),
      })
      .strict(),
  )
  .max(16)
  .refine(
    (samples) =>
      new Set(samples.map((sample) => `${sample.plugin}:${sample.id}`)).size ===
      samples.length,
  );
export function validateCodeSamples(value: unknown) {
  const parsed = codeSamples.safeParse(value);
  if (!parsed.success) throw new Error('Invalid generated code samples');
  return parsed.data;
}
const parameter = z
  .object({
    name,
    in: z.enum(['path', 'query', 'header', 'cookie']),
    required: z.boolean(),
    description: text,
    schema: object,
    style: z.string().optional(),
    explode: z.boolean().optional(),
    example: z.unknown().optional(),
    examples: object.optional(),
    content: content.optional(),
    allowReserved: z.boolean().optional(),
    deprecated: z.boolean().optional(),
  })
  .strict();
const operation = z
  .object({
    codeSamples: codeSamples.optional(),
    kind: z.enum(['endpoint', 'webhook', 'callback']).optional(),
    callback: z
      .object({ operationId: name, name, expression: name })
      .strict()
      .optional(),
    externalDocs: z
      .object({ url: text, description: text.optional() })
      .strict()
      .optional(),
    id: name,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    method: z.enum([
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'head',
      'options',
      'trace',
    ]),
    path: name,
    summary: text,
    description: text,
    tags: z.array(name).max(1000),
    deprecated: z.boolean(),
    lifecycle: z
      .custom<OperationLifecycle>(
        (value) => lifecycleIssues(value).length === 0,
      )
      .optional(),
    parameters: z.array(parameter).max(1000),
    requestBody: z
      .object({ required: z.boolean(), description: text, content })
      .strict()
      .optional(),
    responses: z
      .array(
        z
          .object({
            status: z.string().regex(/^(?:[1-5](?:\d\d|XX)|default)$/),
            description: text,
            content,
            headers: object,
          })
          .strict(),
      )
      .max(1000),
    security: z.array(z.record(z.string(), z.array(z.string()))).max(1000),
    servers: z.array(text).max(1000),
    source: text,
  })
  .strict();
const guideSchema = z
  .object({
    sourceBytes: z
      .number()
      .int()
      .nonnegative()
      .max(2 * 1024 * 1024)
      .optional(),
    links: z
      .array(z.object({ url: text, kind: z.enum(['link', 'image']) }).strict())
      .max(10_000)
      .optional(),
    anchors: z.array(name).max(10_000).optional(),
    order: z.number().finite(),
    slug: z.string().regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/),
    title: name,
    description: text,
    group: name,
    html: text,
    text,
    source: text,
    headings: z
      .array(
        z
          .object({
            id: name,
            text,
            level: z.number().int().min(1).max(6),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    config: object,
    readerExtensions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
            entry: z
              .string()
              .regex(/^reader-extensions\/[A-Za-z0-9/._-]+\.m?js$/),
          })
          .strict(),
      )
      .max(8)
      .optional(),
    assetMetadata: z
      .array(
        z
          .object({ path: name, hash: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict(),
      )
      .max(2000)
      .optional(),
    navigationTotal: z.number().int().nonnegative().optional(),
    navigationTruncated: z.boolean().optional(),
    pluginVersions: z.array(object).max(32).optional(),
    apis: z
      .array(
        z
          .object({
            operationIndex: z
              .string()
              .regex(/^api-index\/(?:0|[1-9]\d{0,2})\/catalog\.json$/)
              .optional(),
            openapiVersion: z.string().optional(),
            id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
            version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
            title: text,
            description: text,
            source: text,
            operations: z.array(operation).max(100_000),
            schemas: z.record(z.string(), object),
            securitySchemes: z.record(z.string(), object),
            diagnostics: z
              .array(
                z
                  .object({
                    code: name,
                    severity: z.enum(['warning', 'error']),
                    message: text,
                    source: text.optional(),
                  })
                  .strict(),
              )
              .max(10_000),
            servers: z.array(text).max(1000),
          })
          .strict(),
      )
      .max(128),
    guides: z.array(guideSchema).max(10_000),
    guideTranslations: z
      .record(
        z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
        z.array(guideSchema).max(10000),
      )
      .refine((value) => Object.keys(value).length <= 16)
      .optional(),
    diagnostics: z
      .array(
        z
          .object({
            code: name,
            severity: z.enum(['warning', 'error']),
            message: text,
            source: text.optional(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
/** Reject malformed graph data without reflecting plugin-controlled payloads in errors. */
export function validatePluginSite(value: unknown): SiteData {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new Error(
      'Invalid plugin output: graph fields do not match the supported data contract',
    );
  const site = result.data as unknown as SiteData;
  const identities = new Set<string>();
  let sampleBytes = 0;
  for (const [index, api] of site.apis.entries()) {
    if (
      api.operationIndex !== undefined &&
      api.operationIndex !== `api-index/${index}/catalog.json`
    )
      throw new Error('Invalid plugin output: mismatched endpoint catalog');
    const key = `${api.id}:${api.version}`;
    if (identities.has(key))
      throw new Error('Invalid plugin output: duplicate API identity');
    identities.add(key);
    const slugs = new Set<string>(),
      ids = new Set<string>();
    for (const operation of api.operations) {
      for (const sample of operation.codeSamples ?? [])
        sampleBytes += Buffer.byteLength(sample.code);
      if (sampleBytes > 16 * 1024 * 1024)
        throw new Error('Generated code samples exceed 16 MiB total');
      if (slugs.has(operation.slug) || ids.has(operation.id))
        throw new Error('Invalid plugin output: duplicate operation identity');
      slugs.add(operation.slug);
      ids.add(operation.id);
      for (const requirement of operation.security)
        for (const name of Object.keys(requirement))
          if (!Object.hasOwn(api.securitySchemes, name))
            throw new Error('Invalid plugin output: undefined security scheme');
    }
  }
  if (
    new Set(site.guides.map((guide) => guide.slug)).size !== site.guides.length
  )
    throw new Error('Invalid plugin output: duplicate guide route');
  validateGuideTranslations(site);
  return site;
}
