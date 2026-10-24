import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { availableParallelism, cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createStaticServer } from '@davidniessen/doctopus-cli';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';
import { toolVersion } from '@davidniessen/doctopus-contracts';
const count = Number(process.argv[2] ?? 10);
if (!Number.isInteger(count) || count < 5 || count > 30)
  throw new Error('Choose 5–30 cold samples per route');
const directory = resolve('.doctopus/browser-benchmark', String(Date.now()));
await mkdir(directory, { recursive: true });
const profile = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  cpuSlowdown: 4,
  latencyMs: 150,
  downloadBitsPerSecond: 1_600_000,
  uploadBitsPerSecond: 750_000,
};
const publication = await verifyArtifact(
  resolve('examples/demo/.doctopus/site'),
);
assert.equal(
  publication.compilerVersion,
  toolVersion,
  'Rebuild the demo with the current compiler.',
);
const app = await createStaticServer(resolve('examples/demo/.doctopus/site'));
let browser;
try {
  const origin = await app.listen({ port: 0, host: '127.0.0.1' });
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: ['--no-sandbox'],
  });
  const measurements = [];
  for (const [name, path] of [
    ['guide', '/guides/quickstart/'],
    ['endpoint', '/api/orbit/v1/list-projects/'],
  ]) {
    const samples = [];
    for (let i = 0; i < count; i++) {
      const context = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'light',
        serviceWorkers: 'block',
      });
      try {
        const page = await context.newPage();
        const errors = [],
          scripts = [];
        let collectInitial = true;
        page.on('pageerror', (error) => errors.push(error.message));
        await context.route('**/*', (route) => {
          if (new URL(route.request().url()).origin === origin)
            return route.continue();
          errors.push('Unexpected external request');
          return route.abort();
        });
        page.on('response', (response) => {
          if (collectInitial && response.request().resourceType() === 'script')
            scripts.push(
              response
                .body()
                .then((body) => ({
                  bytes: body.length,
                  gzip: gzipSync(body).length,
                }))
                .catch(() => {
                  errors.push('Initial script could not be read');
                  return { bytes: 0, gzip: 0 };
                }),
            );
        });
        const session = await context.newCDPSession(page);
        await session.send('Network.enable');
        await session.send('Network.setCacheDisabled', { cacheDisabled: true });
        await session.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: profile.latencyMs,
          downloadThroughput: profile.downloadBitsPerSecond / 8,
          uploadThroughput: profile.uploadBitsPerSecond / 8,
          connectionType: 'cellular4g',
        });
        await session.send('Emulation.setCPUThrottlingRate', {
          rate: profile.cpuSlowdown,
        });
        await page.addInitScript(() => {
          const state = (globalThis.__readerBenchmark = {
            lcp: 0,
            cls: 0,
            interaction: null,
          });
          new globalThis.PerformanceObserver((list) => {
            for (const entry of list.getEntries()) state.lcp = entry.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
          let start = 0,
            last = 0,
            score = 0;
          new globalThis.PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.hadRecentInput) continue;
              if (
                entry.startTime - last > 1000 ||
                entry.startTime - start > 5000
              ) {
                start = entry.startTime;
                score = 0;
              }
              last = entry.startTime;
              score += entry.value;
              state.cls = Math.max(state.cls, score);
            }
          }).observe({ type: 'layout-shift', buffered: true });
          globalThis.document.addEventListener(
            'click',
            (event) => {
              if (!event.target?.closest?.('.search-trigger')) return;
              const start = performance.now();
              globalThis.requestAnimationFrame(() =>
                globalThis.requestAnimationFrame(() => {
                  state.interaction = performance.now() - start;
                }),
              );
            },
            true,
          );
        });
        const response = await page.goto(`${origin}${path}`, {
          waitUntil: 'networkidle',
          timeout: 30_000,
        });
        assert.equal(response.status(), 200, `${name} route must exist`);
        await page.waitForFunction(
          () => performance.getEntriesByName('doctopus:hydrated').length > 0,
        );
        const metrics = await page.evaluate(() => ({
          lcpMs: globalThis.__readerBenchmark.lcp,
          cls: globalThis.__readerBenchmark.cls,
          hydrationMs:
            performance.getEntriesByName('doctopus:hydrated')[0].startTime,
        }));
        assert(metrics.lcpMs > 0, 'LCP observer must report an actual paint');
        collectInitial = false;
        const downloaded = await Promise.all(scripts);
        if (i === 0)
          await page.screenshot({
            path: join(directory, `${name}-mobile.png`),
          });
        await page
          .getByRole('button', { name: 'Search documentation', exact: true })
          .click();
        await page
          .getByRole('dialog', { name: 'Search documentation' })
          .waitFor({ state: 'visible' });
        await page.waitForFunction(
          () => globalThis.__readerBenchmark.interaction !== null,
        );
        const interactionMs = await page.evaluate(
          () => globalThis.__readerBenchmark.interaction,
        );
        assert.deepEqual(
          errors,
          [],
          'Browser errors or external requests invalidate the sample',
        );
        samples.push({
          ...metrics,
          interactionMs,
          initialJavaScriptBytes: downloaded.reduce(
            (sum, item) => sum + item.bytes,
            0,
          ),
          initialJavaScriptGzipBytes: downloaded.reduce(
            (sum, item) => sum + item.gzip,
            0,
          ),
        });
        process.stdout.write(
          `${name} ${i + 1}/${count}: LCP ${Math.round(metrics.lcpMs)}ms, CLS ${metrics.cls.toFixed(4)}, search open ${Math.round(interactionMs)}ms\n`,
        );
      } finally {
        await context.close();
      }
    }
    const percentile = (key, fraction) =>
      samples.map((item) => item[key]).sort((a, b) => a - b)[
        Math.ceil(samples.length * fraction) - 1
      ];
    measurements.push({
      name,
      path,
      samples,
      medianLcpMs: percentile('lcpMs', 0.5),
      p95LcpMs: percentile('lcpMs', 0.95),
      maxCls: Math.max(...samples.map((item) => item.cls)),
      p95InteractionMs: percentile('interactionMs', 0.95),
      maxInitialJavaScriptGzipBytes: Math.max(
        ...samples.map((item) => item.initialJavaScriptGzipBytes),
      ),
    });
  }
  const report = {
    toolVersion,
    artifactCompilerVersion: publication.compilerVersion,
    timestamp: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    sourceWorkingTreeDirty:
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim().length > 0,
    artifactDigest: publication.artifactDigest,
    browser: browser.version(),
    node: process.version,
    availableCpus: availableParallelism(),
    cpuModel: cpus()[0]?.model,
    profile,
    cache:
      'new browser context, HTTP cache disabled, service workers blocked for every navigation',
    delivery:
      'loopback CLI static server, uncompressed HTTP, existing production demo artifact',
    interaction:
      'search click capture to second animation frame after the dialog opens; scripted lab latency, not field INP',
    budgets: {
      p95LcpMs: 2500,
      maxCls: 0.1,
      p95InteractionMs: 200,
      initialGuideJavaScriptGzipBytes: 150 * 1024,
    },
    measurements,
  };
  await writeFile(
    join(directory, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  const failures = measurements.flatMap((item) => [
    ...(item.p95LcpMs > report.budgets.p95LcpMs
      ? [`${item.name} LCP exceeded budget`]
      : []),
    ...(item.maxCls > report.budgets.maxCls
      ? [`${item.name} CLS exceeded budget`]
      : []),
    ...(item.p95InteractionMs > report.budgets.p95InteractionMs
      ? [`${item.name} interaction exceeded budget`]
      : []),
    ...(item.name === 'guide' &&
    item.maxInitialJavaScriptGzipBytes >
      report.budgets.initialGuideJavaScriptGzipBytes
      ? ['Initial guide JavaScript exceeded budget']
      : []),
  ]);
  process.stdout.write(`Browser report: ${join(directory, 'report.json')}\n`);
  if (failures.length) throw new Error(failures.join('; '));
} finally {
  await browser?.close();
  await app.close();
}
