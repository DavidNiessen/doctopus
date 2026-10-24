import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [socket, container, deadline, volume] = process.argv.slice(2);
if (
  !socket?.startsWith('/') ||
  !/^[a-f0-9]{64}$/.test(container ?? '') ||
  !Number.isSafeInteger(Number(deadline)) ||
  !/^doctopus-build-[a-f0-9-]{36}$/.test(volume ?? '')
)
  process.exit(1);
const environment = { ...process.env };
for (const name of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete environment[name];
const exec = promisify(execFile);
let complete = false,
  cleaning = false;
async function cleanup() {
  if (complete || cleaning) return;
  cleaning = true;
  // The immutable container id prevents touching another operator's container.
  for (let attempt = 0; attempt < 6; attempt++) {
    let gone = false;
    try {
      await exec(
        'docker',
        [`--host=unix://${socket}`, 'rm', '--force', container!],
        { env: environment, timeout: 30_000, maxBuffer: 64 * 1024 },
      );
      gone = true;
    } catch {
      try {
        const result = await exec(
          'docker',
          [
            `--host=unix://${socket}`,
            'ps',
            '--all',
            '--quiet',
            '--no-trunc',
            '--filter',
            `id=${container}`,
          ],
          { env: environment, timeout: 10_000, maxBuffer: 1024 },
        );
        if (!result.stdout.trim()) gone = true;
      } catch {
        /* Daemon unavailability is not evidence the container is gone. */
      }
    }
    if (gone) {
      try {
        await exec(
          'docker',
          [`--host=unix://${socket}`, 'volume', 'rm', volume!],
          { env: environment, timeout: 30_000, maxBuffer: 64 * 1024 },
        );
        process.exit(0);
      } catch {
        try {
          const result = await exec(
            'docker',
            [
              `--host=unix://${socket}`,
              'volume',
              'ls',
              '--quiet',
              '--filter',
              `name=^${volume}$`,
            ],
            { env: environment, timeout: 10_000, maxBuffer: 1024 },
          );
          if (!result.stdout.trim()) process.exit(0);
        } catch {
          /* Retry daemon unavailability. */
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  process.exit(1);
}
const timer = setTimeout(
  () => void cleanup(),
  Math.max(0, Number(deadline) - Date.now()),
);
process.on('disconnect', () => void cleanup());
process.on('message', (message) => {
  if (message === 'complete') {
    complete = true;
    clearTimeout(timer);
    process.exit(0);
  }
});
process.send?.('ready');
