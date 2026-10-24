import { glob, readFile } from 'node:fs/promises';
import { lint as markdownlint } from 'markdownlint/promise';
const files = [];
for await (const file of glob(['**/*.md', '.github/**/*.md'], {
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/target/**',
    '**/.doctopus/**',
    '**/.api-docs/**',
    '**/coverage/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '**/playwright-pages-report/**',
    '.git/**',
  ],
}))
  files.push(file);
if (!files.length) throw new Error('No Markdown files were discovered');
const config = JSON.parse(
  await readFile(new URL('../.markdownlint.json', import.meta.url), 'utf8'),
);
const results = await markdownlint({
  files: [...new Set(files)].sort(),
  config,
});
let count = 0;
for (const [file, errors] of Object.entries(results)) {
  if (!Array.isArray(errors))
    throw new Error('Unexpected Markdown lint result');
  for (const error of errors) {
    console.error(
      `${file}:${error.lineNumber} ${error.ruleNames[0]} ${error.ruleDescription}${error.errorDetail ? `: ${error.errorDetail}` : ''}`,
    );
    count++;
  }
}
console.log(
  `Markdown: ${Object.keys(results).length} files checked, ${count} errors.`,
);
if (count) process.exitCode = 1;
