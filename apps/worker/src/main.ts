import { readTextFile } from '@davidniessen/doctopus-spec';
import { loadWorkerConfig } from './config.js';
import { createWorkerClient } from './protocol.js';
import {
  createIsolatedExecutor,
  createWorkerStorageAdmission,
} from './executor.js';
import { runWorker } from './worker.js';
const controller = new AbortController();
let deadline: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (controller.signal.aborted) return;
  controller.abort();
  deadline = setTimeout(() => {
    console.error(
      'Worker shutdown exceeded its deadline. Its independent container watchdogs retain cleanup ownership.',
    );
    process.exit(1);
  }, 90000);
  deadline.unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
try {
  const file = process.env.BUILD_WORKER_CONFIG_FILE;
  if (!file || process.platform !== 'linux')
    throw new Error('A Linux worker and configuration file are required');
  const credentialFile = process.env.ROOT_TOKEN_FILE;
  const credential = credentialFile
    ? (await readTextFile(credentialFile, 4096)).trim()
    : process.env.ROOT_TOKEN;
  if (!credential) throw new Error('Operator credential is required');
  const config = await loadWorkerConfig(file, credentialFile);
  controller.signal.throwIfAborted();
  await runWorker({
    config,
    signal: controller.signal,
    control: createWorkerClient(
      config.serverUrl,
      credential,
      config.insecureDevelopment,
    ),
    execute: createIsolatedExecutor(config.artifactRoot),
    canStart: createWorkerStorageAdmission(
      config.artifactRoot,
      controller.signal,
    ),
    report: (event, jobId) =>
      console.info(JSON.stringify({ event, ...(jobId ? { jobId } : {}) })),
  });
} catch {
  if (!controller.signal.aborted) {
    console.error(
      'Worker failed. Check its configuration, operator access, prepared sources, local Docker and artifact storage.',
    );
    process.exitCode = 1;
  }
} finally {
  clearTimeout(deadline);
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
