#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { watch } from 'node:fs';
import {
  compileProject,
  auditDocumentation,
  checkProjectPluginConformance,
} from '@davidniessen/doctopus-compiler';
import {
  confinedPath,
  readTextFile,
  parseSource,
  parseReferencePolicy,
  loadSpec,
  diffApi,
} from '@davidniessen/doctopus-spec';
import {
  lifecycleReport,
  isCalendarDate,
  toolVersion,
} from '@davidniessen/doctopus-contracts';
import {
  buildSite,
  createStaticServer,
  stageArtifact,
  createDevelopmentBuilder,
  importRemoteSpec,
  vendorRemoteSpec,
  buildIsolatedSite,
  inspectIsolatedSource,
} from './index.js';
const program = new Command()
  .name('doctopus')
  .description(
    'Self-hosted API documentation: build, validate, preview and publish.',
  )
  .version(toolVersion);
const buildOptions = (command: Command): Command =>
  command
    .option('-c, --config <file>', 'project config file', 'docs.config.yaml')
    .option(
      '-o, --output <directory>',
      'output directory inside the project .doctopus folder',
      '.doctopus/site',
    )
    .option(
      '--trust-plugins',
      'allow reviewed build plugins and browser extensions',
    )
    .option(
      '--trust-content',
      'allow reviewed MDX content to execute in bounded workers',
    );
program
  .command('import-spec <url> [project]')
  .description('Download and validate a self-contained OpenAPI snapshot')
  .requiredOption(
    '--allow-origin <origin>',
    'exact permitted origin (repeatable)',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .option(
    '-o, --output <file>',
    'relative JSON or YAML destination',
    'openapi.yaml',
  )
  .option(
    '--replace',
    'atomically refresh an existing spec after successful validation',
  )
  .option('--sha256 <digest>', 'require these exact downloaded bytes')
  .option(
    '--bearer-env <name>',
    'read a source bearer token from this environment variable',
  )
  .option('--allow-http', 'explicitly permit cleartext HTTP for this import')
  .option(
    '--allow-private-network',
    'explicitly permit loopback and private-network sources',
  )
  .action(
    async (
      url: string,
      project = '.',
      options: {
        allowOrigin: string[];
        output: string;
        replace?: boolean;
        sha256?: string;
        bearerEnv?: string;
        allowHttp?: boolean;
        allowPrivateNetwork?: boolean;
      },
    ) => {
      let bearerToken: string | undefined;
      if (options.bearerEnv !== undefined) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(options.bearerEnv))
          throw new Error('Invalid bearer environment-variable name');
        bearerToken = process.env[options.bearerEnv];
        if (!bearerToken?.trim())
          throw new Error(
            'Import bearer environment variable is missing or empty',
          );
      }
      const result = await importRemoteSpec(project, url, {
        allowedOrigins: options.allowOrigin,
        output: options.output,
        replace: options.replace === true,
        allowHttp: options.allowHttp === true,
        allowPrivateNetwork: options.allowPrivateNetwork === true,
        ...(options.sha256 !== undefined
          ? { expectedSha256: options.sha256 }
          : {}),
        ...(bearerToken !== undefined ? { bearerToken } : {}),
      });
      console.log(
        `Imported ${result.bytes} bytes to ${result.path} (SHA-256 ${result.sha256}).`,
      );
    },
  );
program
  .command('vendor-spec <policy> [project]')
  .description(
    'Download a pinned external-reference snapshot for offline builds',
  )
  .requiredOption(
    '--allow-origin <origin>',
    'exact operator-approved origin (repeatable)',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .option(
    '-o, --output <directory>',
    'project-relative snapshot directory',
    'spec-snapshots',
  )
  .option('--allow-http', 'explicitly permit HTTP for approved sources')
  .option(
    '--allow-private-network',
    'explicitly permit eligible private/loopback addresses',
  )
  .option(
    '--bearer-env <url=name>',
    'bind a bearer environment variable to one exact source URL (repeatable)',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .action(
    async (
      policyFile: string,
      project = '.',
      options: {
        allowOrigin: string[];
        output: string;
        allowHttp?: boolean;
        allowPrivateNetwork?: boolean;
        bearerEnv: string[];
      },
    ) => {
      const policy = parseReferencePolicy(
        parseSource(
          await readTextFile(
            await confinedPath(project, policyFile),
            64 * 1024,
          ),
          policyFile,
        ),
      );
      const credentials: Record<string, string> = {};
      for (const binding of options.bearerEnv) {
        const separator = binding.lastIndexOf('='),
          url = binding.slice(0, separator),
          name = binding.slice(separator + 1);
        if (
          separator < 1 ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
          !policy.sources.some((source) => source.url === url) ||
          Object.hasOwn(credentials, url)
        )
          throw new Error('Invalid exact-source bearer environment binding');
        const token = process.env[name];
        if (!token?.trim())
          throw new Error(
            'Source bearer environment variable is missing or empty',
          );
        credentials[url] = token;
      }
      const result = await vendorRemoteSpec(project, policy, {
        allowedOrigins: options.allowOrigin,
        output: options.output,
        allowHttp: options.allowHttp === true,
        allowPrivateNetwork: options.allowPrivateNetwork === true,
        credentials,
      });
      console.log(
        `Vendored ${result.sources} pinned sources (${result.bytes} bytes). Configure path: ${result.path}, references: ${result.references}.`,
      );
    },
  );
buildOptions(
  program
    .command('build [project]')
    .alias('export')
    .description('Build a verified static publication'),
).action(
  async (
    project = '.',
    options: {
      config: string;
      output: string;
      trustPlugins?: boolean;
      trustContent?: boolean;
    },
  ) => {
    const result = await buildSite(project, options);
    for (const diagnostic of result.site.diagnostics)
      console.warn(`${diagnostic.severity}: ${diagnostic.message}`);
    console.log(
      `Built ${result.site.guides.length} guides and ${result.site.apis.reduce((count, api) => count + api.operations.length, 0)} endpoints in ${result.directory}`,
    );
  },
);
program
  .command('source-info [project]')
  .description(
    'Inspect the bounded visible source snapshot without executing build code',
  )
  .option('--source-mib <number>', 'source snapshot limit in MiB', '128')
  .option('--json', 'print machine-readable source metadata')
  .action(
    async (project = '.', options: { sourceMib: string; json?: boolean }) => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once('SIGINT', cancel);
      process.once('SIGTERM', cancel);
      try {
        const source = await inspectIsolatedSource(project, {
          sourceMiB: Number(options.sourceMib),
          signal: controller.signal,
        });
        console.log(
          options.json
            ? JSON.stringify({ schemaVersion: 1, source })
            : `Source sha256:${source.digest} · ${source.files} files · ${source.bytes} bytes`,
        );
      } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
      }
    },
  );
buildOptions(
  program
    .command('isolated-build [project]')
    .description(
      'Build offline in an explicitly approved, resource-limited local Docker image',
    ),
)
  .requiredOption(
    '--image <digest>',
    'immutable local image id or repository digest',
  )
  .option(
    '--source-digest <sha256>',
    'require an approved visible-source snapshot digest',
  )
  .option('--socket <path>', 'local Docker Unix socket', '/var/run/docker.sock')
  .option(
    '--timeout-ms <number>',
    'wall-clock deadline in milliseconds',
    '180000',
  )
  .option('--memory-mib <number>', 'container memory limit in MiB', '2048')
  .option('--cpus <number>', 'CPU limit', '2')
  .option('--pids <number>', 'process limit', '128')
  .option('--source-mib <number>', 'source snapshot limit in MiB', '128')
  .option('--output-mib <number>', 'output volume limit in MiB', '256')
  .option('--json', 'print a machine-readable build receipt')
  .action(
    async (
      project = '.',
      options: {
        image: string;
        sourceDigest?: string;
        socket: string;
        config: string;
        output: string;
        timeoutMs: string;
        memoryMib: string;
        cpus: string;
        pids: string;
        sourceMib: string;
        outputMib: string;
        trustPlugins?: boolean;
        trustContent?: boolean;
        json?: boolean;
      },
    ) => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once('SIGINT', cancel);
      process.once('SIGTERM', cancel);
      try {
        const result = await buildIsolatedSite(project, {
          image: options.image,
          ...(options.sourceDigest === undefined
            ? {}
            : { expectedSourceDigest: options.sourceDigest }),
          socket: options.socket,
          config: options.config,
          output: options.output,
          trustPlugins: options.trustPlugins === true,
          trustContent: options.trustContent === true,
          timeoutMs: Number(options.timeoutMs),
          memoryMiB: Number(options.memoryMib),
          cpus: Number(options.cpus),
          pids: Number(options.pids),
          sourceMiB: Number(options.sourceMib),
          outputMiB: Number(options.outputMib),
          signal: controller.signal,
        });
        console.log(
          options.json
            ? JSON.stringify(result.receipt)
            : `Built isolated publication ${result.manifest.artifactDigest} in ${result.directory}`,
        );
      } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
      }
    },
  );
for (const mode of ['validate', 'doctor'] as const)
  program
    .command(`${mode} [project]`)
    .description(
      'Validate specs, guides, configuration and documentation quality',
    )
    .option('-c, --config <file>', 'project config file', 'docs.config.yaml')
    .option('--strict', 'fail on warnings')
    .option('--json', 'machine-readable output')
    .option(
      '--trust-plugins',
      'allow reviewed build plugins and browser extensions',
    )
    .option(
      '--trust-content',
      'allow reviewed MDX content to execute in bounded workers',
    )
    .action(
      async (
        project = '.',
        options: {
          config: string;
          strict?: boolean;
          json?: boolean;
          trustPlugins?: boolean;
          trustContent?: boolean;
        },
      ) => {
        const site = await compileProject(
          resolve(project),
          options.config,
          options,
        );
        if (mode === 'doctor')
          site.diagnostics = await auditDocumentation(site);
        console.log(
          options.json
            ? JSON.stringify(site.diagnostics)
            : site.diagnostics.length
              ? site.diagnostics
                  .map(
                    (diagnostic) =>
                      `${diagnostic.severity} [${diagnostic.code}] ${diagnostic.message}`,
                  )
                  .join('\n')
              : 'Validation passed with no diagnostics.',
        );
        if (
          site.diagnostics.some(
            (diagnostic) => diagnostic.severity === 'error' || options.strict,
          )
        )
          process.exitCode = 1;
      },
    );
program
  .command('lifecycle [project]')
  .description(
    'Report deprecations, replacements and retirement deadlines offline',
  )
  .option('-c, --config <file>', 'project config file', 'docs.config.yaml')
  .option(
    '--as-of <date>',
    'UTC calendar date for reproducible deadline checks',
    new Date().toISOString().slice(0, 10),
  )
  .option('--api <id>', 'select an API id')
  .option('--api-version <version>', 'select a documentation API version')
  .option(
    '--fail-within <days>',
    'fail for reached or upcoming sunset dates within this window',
  )
  .option(
    '--check-replacements',
    'fail when a declared replacement cannot resolve to a published operation',
  )
  .option(
    '--require-migration',
    'require a migration URL or resolved replacement for every entry',
  )
  .option('--json', 'machine-readable inventory')
  .option(
    '--trust-plugins',
    'allow reviewed build plugins and browser extensions',
  )
  .option('--trust-content', 'allow reviewed MDX content')
  .action(
    async (
      project = '.',
      options: {
        config: string;
        asOf: string;
        api?: string;
        apiVersion?: string;
        failWithin?: string;
        checkReplacements?: boolean;
        requireMigration?: boolean;
        json?: boolean;
        trustPlugins?: boolean;
        trustContent?: boolean;
      },
    ) => {
      if (options.failWithin !== undefined && !/^\d+$/.test(options.failWithin))
        throw new Error('--fail-within must be an integer number of days.');
      if (!isCalendarDate(options.asOf))
        throw new Error('--as-of must be a real YYYY-MM-DD date.');
      const site = await compileProject(
        resolve(project),
        options.config,
        options,
      );
      const report = lifecycleReport(site, {
        asOf: options.asOf,
        windowDays:
          options.failWithin === undefined ? 30 : Number(options.failWithin),
        apiId: options.api,
        apiVersion: options.apiVersion,
      });
      console.log(
        options.json
          ? JSON.stringify(report, null, 2)
          : [
              `Lifecycle inventory as of ${report.asOf} (UTC): ${report.total} operations.`,
              ...report.entries.map(
                (entry) =>
                  `${entry.apiId}@${entry.version} ${entry.method} ${JSON.stringify(entry.path)}: ${entry.status}${entry.lifecycle.sunsetOn ? `; sunset ${entry.lifecycle.sunsetOn}` : ''}${entry.replacementHref ? `; replacement ${entry.replacementHref}` : entry.replacementIssue ? `; replacement ${entry.replacementIssue}` : ''}`,
              ),
            ].join('\n'),
      );
      if (
        options.failWithin !== undefined &&
        report.entries.some(
          (entry) =>
            entry.daysUntilSunset !== undefined &&
            entry.daysUntilSunset <= Number(options.failWithin),
        )
      )
        process.exitCode = 1;
      if (
        options.checkReplacements &&
        report.entries.some((entry) => entry.replacementIssue)
      )
        process.exitCode = 1;
      if (
        options.requireMigration &&
        report.entries.some(
          (entry) => !entry.lifecycle.migrationUrl && !entry.replacementHref,
        )
      )
        process.exitCode = 1;
    },
  );
program
  .command('serve <directory>')
  .description('Serve an existing static publication')
  .option('--port <port>', 'listening port', '3000')
  .option('--host <host>', 'listening interface', '127.0.0.1')
  .action(
    async (directory: string, options: { port: string; host: string }) => {
      const app = await createStaticServer(directory);
      await app.listen({ port: Number(options.port), host: options.host });
      console.log(`Documentation server started on port ${options.port}.`);
      const close = () => {
        void app.close();
      };
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
    },
  );
buildOptions(
  program
    .command('dev [project]')
    .description('Build, watch project sources and serve a local preview'),
)
  .option('--port <port>', 'listening port', '3000')
  .option('--host <host>', 'listening interface', '127.0.0.1')
  .action(
    async (
      project = '.',
      options: {
        config: string;
        output: string;
        trustPlugins?: boolean;
        trustContent?: boolean;
        port: string;
        host: string;
      },
    ) => {
      const root = resolve(project);
      const builder = createDevelopmentBuilder(root, options);
      const result = await builder.build();
      const app = await createStaticServer(result.directory);
      await app.listen({ port: Number(options.port), host: options.host });
      let running = false;
      let pending = false;
      const changes = new Set<string>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const rebuild = async () => {
        if (running) {
          pending = true;
          return;
        }
        running = true;
        try {
          const files = [...changes];
          changes.clear();
          const built = await builder.build(files);
          // Incremental guide edits retain the exact file set. Full builds may
          // replace routes/assets and need a freshly verified membership set.
          if (built.mode === 'full') await app.reloadPublication();
          console.log(
            `${built.mode === 'incremental' ? 'Changed guides' : 'Documentation'} rebuilt. Refresh to see changes.`,
          );
        } catch (error) {
          console.error(
            error instanceof Error ? error.message : 'Build failed',
          );
        } finally {
          running = false;
          if (pending) {
            pending = false;
            void rebuild();
          }
        }
      };
      const watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (
          !filename ||
          /(^|[/\\])(\.doctopus|\.api-docs|node_modules|\.git)([/\\]|$)/.test(
            filename,
          )
        )
          return;
        changes.add(filename);
        clearTimeout(timer);
        timer = setTimeout(() => {
          void rebuild();
        }, 150);
      });
      console.log(
        `Watching project sources. Documentation server started on port ${options.port}.`,
      );
      const close = () => {
        watcher.close();
        clearTimeout(timer);
        void app.close();
      };
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
    },
  );
program
  .command('init [directory]')
  .description(
    'Create a minimal documentation project without overwriting existing files',
  )
  .action(async (directory = '.') => {
    const root = resolve(directory);
    await mkdir(root, { recursive: true });
    const files = {
      'docs.config.yaml':
        'schemaVersion: 1\nname: My API\nspecs:\n  - id: api\n    path: openapi.yaml\n',
      'openapi.yaml':
        'openapi: 3.1.0\ninfo:\n  title: My API\n  version: v1\nservers:\n  - url: https://api.example.com\npaths:\n  /health:\n    get:\n      operationId: getHealth\n      summary: Get health\n      tags: [Health]\n      description: Check whether the API is available.\n      responses:\n        "200":\n          description: Healthy\n          content:\n            application/json:\n              schema:\n                type: object\n                properties:\n                  status:\n                    type: string\n                    example: ok\n        "503":\n          description: Temporarily unavailable\n',
      'guides/introduction.md':
        '---\ntitle: Introduction\ndescription: Welcome to your API documentation.\n---\n\n## Get started\n\nConfigure your OpenAPI source in `docs.config.yaml`, then build and serve your documentation.\n',
    };
    for (const file of Object.keys(files)) {
      try {
        await access(join(root, file));
        throw new Error(`Refusing to overwrite ${file}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    for (const [file, content] of Object.entries(files)) {
      await mkdir(resolve(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), content, { flag: 'wx' });
    }
    console.log(
      'Created docs.config.yaml, openapi.yaml and guides/introduction.md.',
    );
  });
program
  .command('diff <before> <after>')
  .description('Classify API contract changes and flag uncertain compatibility')
  .option('--json', 'machine-readable change array')
  .option('--allow-review', 'allow review findings without a failing exit code')
  .action(
    async (
      before: string,
      after: string,
      options: { json?: boolean; allowReview?: boolean },
    ) => {
      const load = async (file: string) => {
        const absolute = resolve(file);
        return loadSpec(dirname(absolute), {
          id: 'api',
          path: basename(absolute),
        });
      };
      const [oldApi, newApi] = await Promise.all([load(before), load(after)]);
      const changes = diffApi(oldApi, newApi);
      console.log(
        options.json
          ? JSON.stringify(changes)
          : changes.length
            ? changes
                .map(
                  (change) =>
                    `${change.severity} [${change.code}] ${change.operation} ${change.location}: ${change.message}${change.referenceUrl ? ` See ${change.referenceUrl}` : ''}`,
                )
                .join('\n')
            : 'No classified contract changes detected. See the documented compatibility coverage.',
      );
      if (changes.some((change) => change.severity === 'breaking'))
        process.exitCode = 1;
      else if (
        !options.allowReview &&
        changes.some((change) => change.severity === 'review')
      )
        process.exitCode = 2;
    },
  );
program
  .command('plugin-check <file> [project]')
  .description('Check a reviewed plugin across two complete project builds')
  .requiredOption(
    '--trust-plugins',
    'acknowledge execution of reviewed local code',
  )
  .option('-c, --config <file>', 'project config file', 'docs.config.yaml')
  .option('--trust-content', 'allow reviewed MDX in the fixture')
  .action(
    async (
      file: string,
      project = '.',
      options: { config: string; trustContent?: boolean },
    ) => {
      const root = resolve(project);
      const site = await checkProjectPluginConformance(
        root,
        [file],
        options.config,
        {
          trustContent: options.trustContent ?? false,
        },
      );
      console.log(
        `Plugin conformance passed: ${site.pluginVersions![0]!.name}@${site.pluginVersions![0]!.version}. Fresh executions returned identical validated output.`,
      );
    },
  );
program
  .command('stage <directory>')
  .description(
    'Stage a verified publication in operator-controlled immutable storage',
  )
  .requiredOption('--store <directory>', 'artifact store root')
  .action(async (directory: string, options: { store: string }) => {
    console.log(
      await stageArtifact(resolve(directory), resolve(options.store)),
    );
  });
program
  .command('publish <artifact>')
  .description('Register and activate a staged publication')
  .requiredOption('--server <origin>', 'management server HTTPS origin')
  .requiredOption('--project <id>', 'project id or slug')
  .option(
    '--insecure-development',
    'permit loopback HTTP for local development',
  )
  .action(
    async (
      artifact: string,
      options: {
        server: string;
        project: string;
        insecureDevelopment?: boolean;
      },
    ) => {
      if (!/^[a-f0-9]{64}$/.test(artifact))
        throw new Error('Artifact id must be a SHA-256 digest');
      const url = new URL(options.server);
      if (
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password ||
        (url.protocol !== 'https:' &&
          !(
            options.insecureDevelopment &&
            url.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(url.hostname)
          ))
      )
        throw new Error(
          'Use an HTTPS origin, or explicitly enable local development on loopback',
        );
      const token = process.env.DOCS_PUBLISH_TOKEN;
      if (!token)
        throw new Error('Set DOCS_PUBLISH_TOKEN securely in the environment');
      const call = async (
        path: string,
        payload?: unknown,
      ): Promise<unknown> => {
        const response = await fetch(new URL(path, url), {
          method: payload === undefined ? 'GET' : 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        if (!response.ok)
          throw new Error(`Management API returned HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      };
      const projects = (await call('/api/projects')) as {
        id: string;
        slug: string;
        activePublicationId: string | null;
      }[];
      const project = projects.find(
        (item) => item.id === options.project || item.slug === options.project,
      );
      if (!project) throw new Error('Project not found or not accessible');
      await call(`/api/projects/${project.id}/artifacts`, {
        artifactId: artifact,
      });
      const publication = (await call(
        `/api/projects/${project.id}/publications`,
        {
          artifactId: artifact,
          expectedPublicationId: project.activePublicationId,
          idempotencyKey: process.env.DOCS_IDEMPOTENCY_KEY ?? randomUUID(),
        },
      )) as { id: string };
      console.log(`Activated publication ${publication.id}.`);
    },
  );
void program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Command failed');
  process.exitCode = 1;
});
