import { z } from 'zod';
import { isAllowedOutboundHeader } from '@davidniessen/doctopus-spec';

const methods = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;
const origin = (value: string) => {
  if (
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      !url.hostname.includes('*') &&
      value === value.trim()
    );
  } catch {
    return false;
  }
};
const prefix = (value: string) =>
  /^\/[a-zA-Z0-9._~/-]*$/.test(value) &&
  !value.includes('//') &&
  value.split('/').every((part) => part !== '.' && part !== '..') &&
  value.endsWith('/');
export const relayHeaderAllowed = (name: string) =>
  isAllowedOutboundHeader(name) && !/^(origin|referer|user-agent)$/i.test(name);
const destination = z
  .object({
    origin: z
      .string()
      .max(2048)
      .refine(
        origin,
        'Use an exact HTTP(S) origin without credentials, paths or fragments',
      )
      .transform((value) => new URL(value).origin),
    pathPrefix: z
      .string()
      .max(1024)
      .refine(prefix, 'Use a canonical path subtree ending with /')
      .default('/'),
    methods: z.array(z.enum(methods)).min(1).max(7).default(['GET', 'HEAD']),
    allowHttp: z.boolean().default(false),
    allowPrivateNetwork: z.boolean().default(false),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.origin.startsWith('http:') && !rule.allowHttp)
      context.addIssue({
        code: 'custom',
        message: 'HTTP destinations require explicit allowHttp',
      });
    if (new Set(rule.methods).size !== rule.methods.length)
      context.addIssue({ code: 'custom', message: 'Duplicate relay methods' });
  });
export const relayPolicySchema = z
  .object({
    projects: z
      .record(
        z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
        z
          .object({
            minimumRole: z
              .enum(['viewer', 'editor', 'publisher', 'admin'])
              .default('viewer'),
            destinations: z
              .array(destination)
              .min(1)
              .max(16)
              .refine(
                (rules) =>
                  new Set(rules.map((rule) => rule.origin + rule.pathPrefix))
                    .size === rules.length,
                'Duplicate relay origin/path rule',
              ),
            requestHeaders: z
              .array(
                z
                  .string()
                  .refine(
                    relayHeaderAllowed,
                    'Invalid, session, framing or trusted relay header',
                  ),
              )
              .max(64)
              .default(['Accept', 'Content-Type', 'Authorization'])
              .refine(
                (values) =>
                  new Set(values.map((value) => value.toLowerCase())).size ===
                  values.length,
                'Duplicate relay request headers',
              ),
          })
          .strict(),
      )
      .refine(
        (projects) =>
          Object.keys(projects).length >= 1 &&
          Object.keys(projects).length <= 32,
        'Configure 1–32 relay projects',
      ),
    maxRequestBytes: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024)
      .default(1024 * 1024),
    maxResponseBytes: z
      .number()
      .int()
      .min(1)
      .max(2 * 1024 * 1024)
      .default(2 * 1024 * 1024),
    timeoutMs: z.number().int().min(1).max(30000).default(30000),
    maxConcurrent: z.number().int().min(1).max(16).default(16),
    maxConcurrentPerMember: z.number().int().min(1).max(4).default(2),
    perMinute: z.number().int().min(1).max(60).default(30),
  })
  .strict();
export type RelayConfiguration = z.input<typeof relayPolicySchema>;
export type RelayPolicy = z.output<typeof relayPolicySchema>;
export type RelayProjectPolicy = RelayPolicy['projects'][string];
export function parseRelayPolicy(input: unknown): RelayPolicy {
  return relayPolicySchema.parse(input);
}

/** Most-specific subtrees take precedence; a broader rule cannot bypass narrower method restrictions. */
export function relayDestination(
  policy: RelayProjectPolicy,
  source: string,
  method: string,
) {
  if (
    source.length > 4096 ||
    source !== source.trim() ||
    Array.from(source).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    source.includes('\\')
  )
    throw new Error('Relay destination is not allowed');
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error('Relay destination is not allowed');
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    /%(?:2e|2f|5c|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(url.pathname) ||
    url.pathname.includes('//')
  )
    throw new Error('Relay destination is not allowed');
  const matches = policy.destinations
    .filter(
      (rule) =>
        rule.origin === url.origin && url.pathname.startsWith(rule.pathPrefix),
    )
    .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
  const rule = matches[0];
  if (!rule || !rule.methods.includes(method as (typeof methods)[number]))
    throw new Error('Relay destination or method is not allowed');
  return { url, rule };
}
