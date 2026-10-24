import { globSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';

// Each group gets a fresh server and the real production rate limits. Sharing
// one IP bucket across unrelated browser scenarios makes later groups fail 429.
const files = globSync('tests/studio/**/*.spec.ts').sort();
if (!files.length) throw new Error('No Studio browser acceptance files found');
if (process.argv.length > 2)
  throw new Error(
    'For focused runs, use playwright test --config playwright.studio.config.ts directly.',
  );
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
for (const [index, file] of files.entries()) {
  console.log(`Studio acceptance ${index + 1}/${files.length}: ${file}`);
  const group = basename(file, '.spec.ts');
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'test',
      '--config',
      'playwright.studio.config.ts',
      '--output',
      join('.doctopus/studio-test/results', group),
      file,
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PLAYWRIGHT_HTML_OUTPUT_DIR: join(
          '.doctopus/studio-test/reports',
          group,
        ),
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  `Studio acceptance passed in ${files.length} isolated server groups.`,
);
