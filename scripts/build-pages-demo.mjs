import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '@davidniessen/doctopus-cli';
import { verifyArtifact } from '@davidniessen/doctopus-compiler';
import { parseConfig, parseSource } from '@davidniessen/doctopus-spec';

const repository = fileURLToPath(new URL('../', import.meta.url));
const [owner, name] = (
  process.env.GITHUB_REPOSITORY ?? 'DavidNiessen/doctopus'
).split('/');
const defaultUrl = `https://${owner.toLowerCase()}.github.io${name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '' : '/' + name}`;
const address = new URL(process.env.PAGES_SITE_URL ?? defaultUrl);
if (
  address.protocol !== 'https:' ||
  address.username ||
  address.password ||
  address.search ||
  address.hash
)
  throw new Error(
    'PAGES_SITE_URL must be an HTTPS site URL without credentials, query or fragment.',
  );
const staging = await mkdtemp(join(tmpdir(), 'doctopus-pages-source-'));
try {
  await cp(join(repository, 'examples/pages-demo'), staging, {
    recursive: true,
  });
  const config = parseConfig({
    ...parseSource(
      await readFile(join(staging, 'docs.config.yaml'), 'utf8'),
      'docs.config.yaml',
    ),
    basePath: address.pathname.replace(/\/$/, ''),
    siteUrl: address.origin,
  });
  // A deployment must never turn the demonstration into a live API client.
  if (
    config.explorer?.mode !== 'mock' ||
    config.explorer.relay ||
    config.explorer.oauthClients
  )
    throw new Error(
      'The Pages demo must use local mock mode without relay or OAuth settings.',
    );
  await writeFile(join(staging, 'docs.config.json'), JSON.stringify(config));
  const built = await buildSite(staging, { config: 'docs.config.json' });
  await verifyArtifact(built.directory);
  const output = join(repository, '.doctopus/pages-demo');
  await mkdir(join(repository, '.doctopus'), { recursive: true });
  await rm(output, { recursive: true, force: true });
  await cp(built.directory, output, { recursive: true });
  console.log(`Built local-only demo for ${address.href} at ${output}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
