import { z } from 'zod';
import type {
  UiMessageKey,
  ProjectConfig,
} from '@davidniessen/doctopus-contracts';
import {
  contrastRatio,
  resolvePalette,
  themePresets,
  safeFeedbackUrl,
  isRelayEndpoint,
  defaultUiMessages,
  validUiMessage,
} from '@davidniessen/doctopus-contracts';

const safePath = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/)
  .refine(
    (value) => !value.split('/').includes('..'),
    'Parent traversal is not allowed',
  );
const readerModulePath = safePath.refine(
  (value) =>
    /\.m?js$/.test(value) &&
    value.split('/').every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)),
  'Use a canonical .js or .mjs project path',
);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const palette = z
  .object({
    background: color.optional(),
    surface: color.optional(),
    subtle: color.optional(),
    border: color.optional(),
    text: color.optional(),
    muted: color.optional(),
    heading: color.optional(),
  })
  .strict();
export const configSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    name: z.string().min(1).max(100),
    description: z
      .string()
      .max(500)
      .default('Beautiful documentation for your API.'),
    basePath: z
      .string()
      .default('')
      .refine(
        (value) =>
          value === '' ||
          (/^\/[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(value) &&
            !value.endsWith('/')),
        'Use an empty base path or /path without a trailing slash',
      ),
    logo: safePath.optional(),
    logoDark: safePath.optional(),
    favicon: safePath.optional(),
    assets: safePath.default('public'),
    siteUrl: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.protocol === 'https:' &&
            !url.username &&
            !url.password &&
            url.pathname === '/' &&
            !url.search &&
            !url.hash
          );
        } catch {
          return false;
        }
      }, 'siteUrl must be an HTTPS origin; configure basePath separately')
      .transform((value) => new URL(value).origin)
      .optional(),
    seo: z
      .object({
        index: z.boolean().default(true),
        socialImage: safePath.optional(),
      })
      .strict()
      .prefault({}),
    specs: z
      .array(
        z.object({
          id: safePath.refine(
            (value) => !value.includes('/'),
            'API id cannot contain /',
          ),
          path: safePath,
          references: safePath.optional(),
          version: z
            .string()
            .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
            .optional(),
        }),
      )
      .min(1),
    guides: safePath.default('guides'),
    theme: z
      .object({
        preset: z
          .enum(['mint', 'ocean', 'violet', 'neutral'])
          .default('violet'),
        accent: color.optional(),
        colors: z
          .object({ light: palette.optional(), dark: palette.optional() })
          .strict()
          .optional(),
        sidebarWidth: z.number().int().min(220).max(320).default(274),
        contentWidth: z.number().int().min(600).max(960).default(760),
        stylesheet: safePath
          .refine(
            (value) => value.endsWith('.css'),
            'Stylesheet must be a CSS asset',
          )
          .optional(),
        radius: z.number().min(0).max(24).default(10),
        font: z.enum(['system', 'sans', 'serif']).default('system'),
        codeTheme: z.enum(['dark', 'light']).default('dark'),
        density: z.enum(['comfortable', 'compact']).default('comfortable'),
      })
      .strict()
      .prefault({})
      .transform((theme) => ({
        ...theme,
        accent: theme.accent ?? themePresets[theme.preset],
      })),
    links: z
      .array(
        z.object({
          label: z.string().max(60),
          href: z
            .string()
            .refine(
              (value) => /^https:\/\//.test(value) || /^\/(?!\/)/.test(value),
              'Links must be HTTPS URLs or local absolute paths',
            ),
        }),
      )
      .default([]),
    feedback: z
      .object({
        url: z
          .string()
          .refine(
            safeFeedbackUrl,
            'Feedback URL must be a bounded HTTPS URL without credentials or control characters',
          ),
        label: z.string().trim().min(1).max(60).optional(),
        includePage: z.boolean().optional(),
      })
      .strict()
      .optional(),
    redirects: z
      .record(
        z.string().regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/),
        z.string().regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/),
      )
      .prefault({}),
    i18n: z
      .object({
        messages: z
          .record(
            z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
            z.partialRecord(
              z.enum(
                Object.keys(defaultUiMessages) as [
                  UiMessageKey,
                  ...UiMessageKey[],
                ],
              ),
              z.string().max(512),
            ),
          )
          .refine(
            (value) => Object.keys(value).length <= 16,
            'At most 16 UI locales are supported',
          )
          .prefault({}),
        guides: z
          .record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), safePath)
          .refine(
            (value) => Object.keys(value).length <= 16,
            'At most 16 guide locales are supported',
          )
          .optional(),
      })
      .strict()
      .optional(),
    locales: z
      .array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/))
      .min(1)
      .max(16)
      .refine(
        (values) => new Set(values).size === values.length,
        'Duplicate locales are not allowed',
      )
      .default(['en']),
    defaultLocale: z.string().default('en'),
    readerExtensions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            entry: readerModulePath,
            files: z.array(readerModulePath).max(16).optional(),
          })
          .strict(),
      )
      .max(8)
      .refine(
        (values) =>
          new Set(values.map((value) => value.id)).size === values.length,
        'Duplicate reader extension ids',
      )
      .optional(),
    plugins: z.array(safePath).default([]),
    explorer: z
      .object({
        mode: z.enum(['live', 'mock']).optional(),
        relay: z
          .string()
          .refine(
            isRelayEndpoint,
            'Use a same-origin /api/projects/<project>/relay endpoint',
          )
          .optional(),
        credentialReuse: z.boolean().optional(),
        oauthClients: z
          .record(
            z.string().min(1).max(1024),
            z.record(
              z.string().min(1).max(1024),
              z
                .object({
                  clientId: z.string().trim().min(1).max(1024),
                  issuer: z
                    .string()
                    .url()
                    .refine((value) => {
                      try {
                        const url = new URL(value);
                        return (
                          !url.username &&
                          !url.password &&
                          !url.hash &&
                          !url.search &&
                          (url.protocol === 'https:' ||
                            (url.protocol === 'http:' &&
                              ['localhost', '127.0.0.1', '[::1]'].includes(
                                url.hostname,
                              )))
                        );
                      } catch {
                        return false;
                      }
                    }, 'Use an HTTPS issuer or a loopback HTTP development issuer'),
                })
                .strict(),
            ),
          )
          .optional(),
      })
      .strict()
      .optional(),
    doctor: z
      .object({
        rules: z
          .record(
            z.string().regex(/^[a-z][a-z0-9-]*$/),
            z.enum(['off', 'warning', 'error']),
          )
          .prefault({}),
        suppressions: z
          .array(
            z
              .object({
                code: z.string().regex(/^[a-z][a-z0-9-]*$/),
                source: z.string().min(1).max(2000),
                reason: z.string().trim().min(8).max(500),
              })
              .strict(),
          )
          .max(200)
          .default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.feedback?.includePage && !config.siteUrl)
      context.addIssue({
        code: 'custom',
        path: ['feedback', 'includePage'],
        message:
          'Page feedback context requires an explicitly configured public siteUrl',
      });
    if (
      new Set(config.specs.map((spec) => spec.id + ':' + (spec.version ?? '')))
        .size !== config.specs.length
    )
      context.addIssue({ code: 'custom', message: 'Duplicate API id/version' });
    if (config.logoDark && !config.logo)
      context.addIssue({
        code: 'custom',
        path: ['logoDark'],
        message: 'logoDark requires a default logo',
      });
    for (const mode of ['light', 'dark'] as const) {
      const colors = resolvePalette(config.theme, mode);
      for (const foreground of ['text', 'muted', 'heading'] as const)
        for (const background of ['background', 'surface', 'subtle'] as const)
          if (contrastRatio(colors[foreground], colors[background]) < 4.5)
            context.addIssue({
              code: 'custom',
              path: ['theme', 'colors', mode, foreground],
              message: `${foreground} must reach 4.5:1 contrast against ${background}`,
            });
    }
    const guideRoot = (value: string) =>
      value
        .split('/')
        .filter((part) => part && part !== '.')
        .join('/');
    const defaultRoot = guideRoot(config.guides);
    for (const [locale, path] of Object.entries(config.i18n?.guides ?? {})) {
      if (!config.locales.includes(locale) || locale === config.defaultLocale)
        context.addIssue({
          code: 'custom',
          path: ['i18n', 'guides', locale],
          message: 'Guide roots must use a configured non-default locale',
        });
      const root = guideRoot(path);
      if (
        root === defaultRoot ||
        root.startsWith(defaultRoot + '/') ||
        defaultRoot.startsWith(root + '/')
      )
        context.addIssue({
          code: 'custom',
          path: ['i18n', 'guides', locale],
          message:
            'Translated guide roots must not overlap the default guide directory',
        });
    }
    for (const [locale, messages] of Object.entries(
      config.i18n?.messages ?? {},
    )) {
      if (
        !config.locales.some(
          (configured) =>
            configured === locale || configured.startsWith(locale + '-'),
        )
      )
        context.addIssue({
          code: 'custom',
          path: ['i18n', 'messages', locale],
          message:
            'UI messages must target a configured locale or its base language',
        });
      for (const [key, value] of Object.entries(messages))
        if (!validUiMessage(key as UiMessageKey, value!))
          context.addIssue({
            code: 'custom',
            path: ['i18n', 'messages', locale, key],
            message:
              'Use nonempty plain text with the original named placeholders',
          });
    }
    if (!config.locales.includes(config.defaultLocale))
      context.addIssue({
        code: 'custom',
        message: 'defaultLocale must be included in locales',
      });
  });
export function parseConfig(input: unknown): ProjectConfig {
  return configSchema.parse(input) as ProjectConfig;
}
