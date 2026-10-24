import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
const url = new URL(
  process.argv[2] ?? 'http://127.0.0.1:8088/docs/deploy-smoke/',
);
if (
  url.protocol !== 'http:' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw new Error(
    'Use a controlled loopback HTTP documentation URL without credentials, query or fragment.',
  );
const credential = process.env.BENCHMARK_TOKEN_FILE
  ? (await readFile(process.env.BENCHMARK_TOKEN_FILE, 'utf8')).trim()
  : undefined;
const headers = credential ? { authorization: `Bearer ${credential}` } : {};
const rate = 100,
  count = 3000;
const latencies = [];
let failures = 0,
  inFlight = 0,
  peakInFlight = 0;
async function request(record) {
  const start = performance.now();
  inFlight++;
  peakInFlight = Math.max(peakInFlight, inFlight);
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const content = await response.text();
    if (
      response.status !== 200 ||
      !response.headers.get('content-type')?.includes('text/html') ||
      !content.includes('<html')
    )
      throw new Error('Unexpected documentation response');
    if (record) latencies.push(performance.now() - start);
  } catch {
    if (record) failures++;
    else throw new Error('Warmup failed');
  } finally {
    inFlight--;
  }
}
if (credential) {
  const anonymous = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  await anonymous.arrayBuffer();
  if (![401, 403].includes(anonymous.status))
    throw new Error(
      'The private-doc benchmark requires anonymous access to be denied',
    );
}
for (let warm = 0; warm < 20; warm++) await request(false);
const start = performance.now(),
  requests = [];
for (let index = 0; index < count; index++) {
  const remaining = start + (index * 1000) / rate - performance.now();
  if (remaining > 0) await delay(remaining);
  if (inFlight >= 200) {
    failures++;
    continue;
  }
  requests.push(request(true));
}
await Promise.all(requests);
const duration = performance.now() - start;
latencies.sort((a, b) => a - b);
const report = {
  url: url.href,
  authentication: credential ? 'bearer' : 'anonymous',
  requests: count,
  failures,
  targetRequestsPerSecond: rate,
  observedRequestsPerSecond: +(count / (duration / 1000)).toFixed(2),
  durationSeconds: +(duration / 1000).toFixed(2),
  p50Ms: +(
    latencies[Math.ceil(latencies.length * 0.5) - 1] ?? Infinity
  ).toFixed(2),
  p95Ms: +(
    latencies[Math.ceil(latencies.length * 0.95) - 1] ?? Infinity
  ).toFixed(2),
  peakInFlight,
  node: process.version,
};
await mkdir('.doctopus', { recursive: true });
await writeFile(
  `.doctopus/server-benchmark-${report.authentication}.json`,
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
if (failures || report.p95Ms > 100 || report.observedRequestsPerSecond < 95)
  process.exitCode = 1;
