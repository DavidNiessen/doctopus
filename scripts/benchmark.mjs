import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { toolVersion } from '@davidniessen/doctopus-contracts';
import { createDevelopmentBuilder } from '@davidniessen/doctopus-cli';
import { createSearchIndex, search } from '@davidniessen/doctopus-search';
const count = Number(process.argv[2] ?? 10000);
if (!Number.isInteger(count) || count < 100 || count > 10000)
  throw new Error('Choose 100–10000 operations');
const root = resolve('.doctopus/benchmark', String(Date.now()));
await mkdir(root, { recursive: true });
const paths = {};
const schemas = {};
for (let index = 0; index < count; index++) {
  const name = `Resource${index}`;
  schemas[name] = {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'resource_123' },
      name: { type: 'string' },
      active: { type: 'boolean' },
      score: { type: 'number' },
    },
  };
  paths[`/resources/${index}`] = {
    get: {
      operationId: `resource-${index}`,
      summary: `Retrieve resource ${index}`,
      description: `Retrieve the details of resource ${index} in your workspace.`,
      tags: [`Resources ${index % 10}`],
      responses: {
        200: {
          description: 'Resource details',
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${name}` },
            },
          },
        },
      },
    },
  };
}
await writeFile(
  resolve(root, 'openapi.json'),
  JSON.stringify({
    openapi: '3.1.0',
    info: { title: 'Scale fixture', version: 'v1' },
    paths,
    components: { schemas },
  }),
);
await writeFile(
  resolve(root, 'docs.config.yaml'),
  'name: Scale fixture\nspecs:\n  - id: scale\n    path: openapi.json\n',
);
await mkdir(resolve(root, 'guides'));
const guide =
  '---\ntitle: Scale guide\n---\n\n## Overview\n\nInitial guide body.\n';
await writeFile(resolve(root, 'guides/overview.md'), guide);
const builder = createDevelopmentBuilder(root);
const start = performance.now();
const built = await builder.build();
assert.equal(built.manifest.compilerVersion, toolVersion);
const duration = performance.now() - start;
const index = createSearchIndex(built.site);
const samples = [];
for (let query = 0; query < 100; query++) {
  const start = performance.now();
  if (!search(index, `resource ${query}`).length)
    throw new Error('Benchmark query returned no results');
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const page = await readFile(
  resolve(built.directory, 'api/scale/v1/resource-9999/index.html').replace(
    'resource-9999',
    `resource-${count - 1}`,
  ),
);
const incremental = [];
for (let update = 0; update < 20; update++) {
  const start = performance.now();
  await writeFile(
    resolve(root, 'guides/overview.md'),
    guide + `\nUpdate ${update}.\n`,
  );
  const result = await builder.build(['guides/overview.md']);
  if (result.mode !== 'incremental')
    throw new Error('Guide update unexpectedly used the full build path');
  incremental.push(performance.now() - start);
}
incremental.sort((a, b) => a - b);
const report = {
  toolVersion,
  artifactCompilerVersion: built.manifest.compilerVersion,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  sourceWorkingTreeDirty:
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
      .length > 0,
  fullBuildArtifactDigest: built.manifest.artifactDigest,
  operations: count,
  schemaNodes: count * 5,
  fullBuildSeconds: +(duration / 1000).toFixed(2),
  peakRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
  searchP95Ms: +samples[94].toFixed(2),
  sampleCount: samples.length,
  incrementalGuideP95Ms: +incremental[18].toFixed(2),
  incrementalSamples: incremental.length,
  endpointHtmlKiB: +(page.length / 1024).toFixed(1),
  node: process.version,
  vcpusAvailable: (await import('node:os')).availableParallelism(),
};
await writeFile(
  resolve('.doctopus/benchmark-report.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (
  report.fullBuildSeconds > 120 ||
  report.peakRssMiB > 2048 ||
  report.searchP95Ms > 100 ||
  report.incrementalGuideP95Ms > 2000
)
  process.exitCode = 1;
