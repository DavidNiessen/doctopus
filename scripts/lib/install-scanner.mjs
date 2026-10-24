import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, link, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { x as extract } from 'tar';
import { sha256, verifyScanner } from './container-inventory.mjs';

/** Install a source-pinned Anchore scanner without executing downloaded installers. */
export async function installScanner(tool) {
  assert(
    process.platform === 'linux' && process.arch === 'x64',
    'The pinned scanners currently support Linux x64',
  );
  assert.match(tool.name, /^[a-z][a-z0-9-]*$/);
  assert.match(tool.version, /^\d+\.\d+\.\d+$/);
  for (const digest of [tool.archiveSha256, tool.executableSha256])
    assert.match(digest, /^[a-f0-9]{64}$/);
  const parent = resolve('.doctopus/tools', `${tool.name}-${tool.version}`);
  const executable = join(parent, tool.name);
  await mkdir(parent, { recursive: true });
  try {
    await verifyScanner(executable, tool);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const temporary = await mkdtemp(join(parent, '.download-'));
    try {
      const archive = join(temporary, 'scanner.tar.gz');
      await promisify(execFile)(
        'curl',
        [
          '--fail',
          '--show-error',
          '--location',
          '--proto',
          '=https',
          '--proto-redir',
          '=https',
          '--max-time',
          '90',
          '--max-filesize',
          String(64 * 1024 * 1024),
          '--retry',
          '3',
          '--retry-max-time',
          '120',
          '--output',
          archive,
          `https://github.com/anchore/${tool.name}/releases/download/v${tool.version}/${tool.name}_${tool.version}_linux_amd64.tar.gz`,
        ],
        { timeout: 150000, maxBuffer: 1024 * 1024 },
      );
      assert.equal(
        await sha256(archive),
        tool.archiveSha256,
        'Scanner archive integrity check failed',
      );
      await extract({
        file: archive,
        cwd: temporary,
        strict: true,
        filter: (path, entry) => path === tool.name && entry.type === 'File',
      });
      const extracted = join(temporary, tool.name);
      await verifyScanner(extracted, tool);
      await chmod(extracted, 0o755);
      try {
        await link(extracted, executable);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      await verifyScanner(executable, tool);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return executable;
}
