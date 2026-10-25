import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

const github = 'https://github.com/DavidNiessen/doctopus/blob/master/';

// Keep the repository documentation authoritative. Only public user/operator
// guides belong here; internal plans and release evidence stay in the repository.
export const demoHandbook = [
  [
    'installation',
    'installation/setup',
    'Installation',
    100,
    'Installation and usage',
    'Build from source, publish your first site, and choose a deployment.',
  ],
  [
    'cli',
    'installation/cli',
    'Installation',
    110,
    'CLI reference',
    'Initialize, validate, build, preview and publish documentation.',
  ],
  [
    'github-packages',
    'installation/packages',
    'Installation',
    120,
    'Packages and releases',
    'Understand source installs, registry authentication and available releases.',
  ],
  [
    'direct-integrations',
    'integrations/get-started',
    'Integrations',
    190,
    'Add to your application',
    'Add a bundled API reference with Spring properties or Node options; no site build required.',
  ],
  [
    'integrations',
    'integrations/frameworks',
    'Integrations',
    200,
    'Spring Boot and Node.js',
    'Configure Spring Boot, Express and Fastify in direct or prebuilt mode.',
  ],
  [
    'remote-import',
    'integrations/openapi-import',
    'Integrations',
    210,
    'Import an API specification',
    'Import OpenAPI from your existing framework or generator.',
  ],
  [
    'openapi-compatibility',
    'integrations/openapi-support',
    'Integrations',
    220,
    'OpenAPI compatibility',
    'Supported versions, references, schema features and validation limits.',
  ],
  [
    'authoring',
    'authoring/guides',
    'Authoring',
    300,
    'Write guides',
    'Author Markdown, organize navigation and use reviewed MDX components.',
  ],
  [
    'customization',
    'authoring/customization',
    'Authoring',
    310,
    'Configure your site',
    'Branding, prepared themes, navigation, assets and extensibility.',
  ],
  [
    'plugins',
    'authoring/plugins',
    'Authoring',
    320,
    'Build plugins',
    'Extend the compiler with explicit, versioned plugin contracts.',
  ],
  [
    'versioning',
    'authoring/versions',
    'Authoring',
    330,
    'API versions',
    'Publish and navigate multiple API specifications and versions.',
  ],
  [
    'internationalization',
    'authoring/languages',
    'Authoring',
    340,
    'Languages',
    'Translate guides and the reader while retaining clear fallbacks.',
  ],
  [
    'snippets',
    'authoring/snippets',
    'Authoring',
    350,
    'Code samples',
    'Configure request snippets and custom language generators.',
  ],
  [
    'explorer-auth',
    'playground/authentication',
    'Playground',
    400,
    'Authentication',
    'Prepare credentials and understand their browser lifetime.',
  ],
  [
    'explorer-bodies',
    'playground/request-bodies',
    'Playground',
    410,
    'Request bodies',
    'Edit JSON, forms and structured request bodies.',
  ],
  [
    'request-serialization',
    'playground/parameters',
    'Playground',
    420,
    'Parameters and serialization',
    'Control path, query, header and cookie serialization.',
  ],
  [
    'mock-responses',
    'playground/mock-responses',
    'Playground',
    430,
    'Mock responses',
    'Generate local examples without calling a live API.',
  ],
  [
    'server',
    'operations/server',
    'Operations',
    500,
    'Server and Studio',
    'Manage projects, access and immutable publications.',
  ],
  [
    'studio-builds',
    'operations/studio-builds',
    'Operations',
    510,
    'Manage builds',
    'Register approved sources and follow queued builds in Studio.',
  ],
  [
    'build-worker',
    'operations/worker',
    'Operations',
    520,
    'Build Worker',
    'Run approved isolated builds on a separate worker host.',
  ],
  [
    'deployment',
    'operations/deployment',
    'Operations',
    530,
    'Deployment and recovery',
    'Deploy containers, protect credentials and restore backups.',
  ],
  [
    'offline-installation',
    'operations/offline',
    'Operations',
    540,
    'Offline installations',
    'Prepare and verify a portable installation without runtime downloads.',
  ],
  [
    'lifecycle',
    'operations/lifecycle',
    'Operations',
    550,
    'Publication lifecycle',
    'Retain, activate and recover immutable documentation artifacts.',
  ],
  [
    'doctor',
    'operations/diagnostics',
    'Operations',
    560,
    'Diagnostics',
    'Check sources, links and publications before deployment.',
  ],
].map(([source, slug, group, order, title, description]) => ({
  source: `docs/${source}.md`,
  slug,
  group,
  order,
  title,
  description,
}));

/** Rewrite authored Markdown links while leaving code examples untouched. */
export function handbookMarkdown(
  source,
  sourcePath,
  targetSlug,
  entries = demoHandbook,
) {
  const routes = new Map(entries.map((entry) => [entry.source, entry.slug]));
  const fragment = (hash) =>
    hash && !hash.startsWith('#heading-') ? `#heading-${hash.slice(1)}` : hash;
  const destination = (url, image) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(url)) return url;
    if (url.startsWith('#')) return fragment(url);
    const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
    if (!match) return url;
    const [, path, query = '', hash = ''] = match;
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return url;
    }
    const resolved = posix.normalize(
      posix.join(posix.dirname(sourcePath), decoded),
    );
    const route = routes.get(resolved);
    if (route && !image) {
      return (
        posix.relative(posix.dirname(targetSlug), `${route}.md`) +
        query +
        fragment(hash)
      );
    }
    return `${image ? 'https://raw.githubusercontent.com/DavidNiessen/doctopus/master/' : github}${resolved}${query}${hash}`;
  };
  let fence;
  return source
    .replace(/^# [^\n]+\r?\n/, '')
    .split('\n')
    .map((line) => {
      const delimiter = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (delimiter) {
        if (!fence) fence = delimiter;
        else if (delimiter[0] === fence[0] && delimiter.length >= fence.length)
          fence = undefined;
        return line;
      }
      if (fence) return line;
      // Match a whole link before code inside its label. A literal code span
      // encountered first remains untouched, including any example links.
      return line.replace(
        /(`+[^`]*`+)|(!?)\[([^\]]*)\]\(([^\s)]+)\)|^(\s{0,3}\[[^\]]+\]:\s*)(\S+)/g,
        (_, code, image, label, url, reference, referenceUrl) => {
          if (code) return code;
          if (reference) return reference + destination(referenceUrl, false);
          return `${image}[${label}](${destination(url, image)})`;
        },
      );
    })
    .join('\n')
    .trimStart();
}

export async function stageDemoHandbook(repository, staging) {
  for (const entry of demoHandbook) {
    const source = await readFile(join(repository, entry.source), 'utf8');
    const markdown = handbookMarkdown(source, entry.source, entry.slug);
    const frontmatter = [
      '---',
      ...['title', 'description', 'group', 'order'].map(
        (key) => `${key}: ${JSON.stringify(entry[key])}`,
      ),
      '---',
      '',
    ].join('\n');
    const target = join(staging, 'guides', `${entry.slug}.md`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, frontmatter + markdown);
  }
}
