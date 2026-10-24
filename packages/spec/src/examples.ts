import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ApiDocument, Diagnostic } from '@davidniessen/doctopus-contracts';
/** Validate authored data in a bounded worker; never dereference network examples. */
export async function checkExamples(
  api: ApiDocument,
  options: { timeoutMs?: number } = {},
): Promise<Diagnostic[]> {
  const timeout = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 50 || timeout > 60_000)
    throw new Error('Invalid example validation timeout');
  const input = JSON.stringify(api);
  if (Buffer.byteLength(input) > 128 * 1024 * 1024)
    throw new Error('Example validation input exceeds 128 MiB');
  return await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=512',
        fileURLToPath(new URL('./examples-worker.js', import.meta.url)),
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let failed = false,
      size = 0;
    const chunks: Buffer[] = [];
    const fail = (message: string) => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new Error(message));
    };
    const timer = setTimeout(
      () =>
        fail(
          'Example validation exceeded its execution limit; simplify pathological schemas or examples',
        ),
      timeout,
    );
    child.once('error', () =>
      fail('Unable to start example validation worker'),
    );
    child.stdin.on('error', () =>
      fail('Example validation worker input failed'),
    );
    child.stdout.on('error', () =>
      fail('Example validation worker output failed'),
    );
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        fail('Example diagnostics exceed 4 MiB');
        return;
      }
      chunks.push(chunk);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0) {
        reject(
          new Error(
            'Example validation failed or exceeded its schema/resource budget',
          ),
        );
        return;
      }
      try {
        resolve(
          JSON.parse(Buffer.concat(chunks).toString('utf8')) as Diagnostic[],
        );
      } catch {
        reject(new Error('Invalid example validation output'));
      }
    });
    child.stdin.end(input);
  });
}
