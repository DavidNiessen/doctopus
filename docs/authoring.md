# Authoring guides and reusable components

This guide covers optional compiled documentation sites with authored guides. A basic [Spring or Node direct integration](direct-integrations.md) loads its API spec without a Markdown directory or project config file.

Put `.md` files under the configured `guides` directory. Subdirectories produce nested URLs; `guides/setup/java.md` becomes `/guides/setup/java/`. Markdown supports tables, task lists, code fences, stable heading links and sanitized content. The search index contains rendered text, so removed scripts and MDX source code are not indexed.

Enable an optional [page feedback link](feedback.md) to send readers to your configured issue tracker from guides and API pages. It also works without JavaScript; canonical page context is opt-in.

## Frontmatter

```yaml
---
title: Create your first project
description: Make your first successful API request.
group: Getting started
order: 10
---
```

All fields are optional. Without a title, the first rendered H1 or filename supplies it. Frontmatter is validated: title is 1–200 characters, description at most 1000, group 1–80, and order a finite number between -1,000,000 and 1,000,000. Unknown fields produce an error. Empty frontmatter is accepted. Duplicate normalized routes, including a `.md` and `.mdx` with the same slug, fail the build.

The loader rejects symlink entries, caps directory nesting at 24, directory entries at 25,000, guides at 10,000, individual sources at 2 MiB and total guide source at 64 MiB. The optional guide directory may be absent. Missing files during an active build fail rather than publishing a partial result.

## Trusted MDX

MDX executes JavaScript and imports during the build. Ordinary Markdown does not. A `.mdx` file causes an actionable error until the caller explicitly passes `--trust-content`:

```sh
node packages/cli/dist/main.js build examples/components --trust-content
node packages/cli/dist/main.js dev examples/components --trust-content --port 3001
node packages/cli/dist/main.js validate examples/components --trust-content
```

Review all MDX and imported modules first. Each guide runs in a child Node process with a five-second deadline, a 192 MiB V8 heap ceiling and bounded input/output. Rendered HTML is sanitized before publication. Arbitrary worker logs and exception messages are not forwarded, because they could contain build secrets. These controls improve failure containment; they are **not a security sandbox**. Trusted code retains filesystem, process, environment and network privileges. Use a separate least-privileged build container/job without production secrets for third-party content. Production reader containers execute only the generated static output and need no MDX runtime.

Relative imports of reviewed JavaScript modules work from the guide's directory. Keep those modules in source control and package any dependencies in the build environment. A browser does not download or execute the authored MDX module.

## Built-in component catalog

Components are injected automatically into MDX; no import is required. See the runnable [component gallery](../examples/components/guides/components.mdx).

| Component            | Purpose                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `Callout`            | A note with optional `title` and `type`: `info`, `tip`, `warning` or `danger` |
| `Tabs` / `Tab`       | Named panels; each `Tab` has a `title`                                        |
| `Steps` / `Step`     | Ordered instructions with an optional step `title`                            |
| `Accordion`          | Native expandable details with a `title`                                      |
| `CardGroup` / `Card` | Responsive linked cards with a `title` and safe `href`                        |
| `CodeGroup`          | Groups Markdown code fences using the reader's code styling                   |
| `Schema`             | Displays a portable JSON schema object supplied through `schema`              |
| `ApiLink`            | Documentation links that adapt local paths to the configured base path        |

Tabs support click, Left/Right, Home/End and standard tab focus. Every panel remains readable when JavaScript is disabled; the reader progressively enhances the panels after startup. Cards and API links accept local absolute paths, heading anchors and HTTPS URLs. Their local paths adapt to the configured base path. Active HTML such as scripts is removed from the rendered artifact.

```mdx
<Tabs>
  <Tab title="JavaScript">Use the built-in fetch client.</Tab>
  <Tab title="Java">Use the standard HTTP client.</Tab>
</Tabs>

<Callout title="Before production" type="warning">
  Confirm the API key's permissions.
</Callout>
```

## Portable guide links

Link to another guide with `[Authentication](authentication.md#heading-authentication)` or a nested relative `.md`/`.mdx` path. Compilation rewrites it to the generated URL under `basePath`. Use the actual generated heading id, which begins with `heading-`. Root-relative links and `/media/` image paths receive the publication prefix once. Run [doctor](doctor.md) to check local destinations, fragments, images and explicit exceptions without network requests.

## Translated guides

Use [authored guide variants](internationalization.md#author-translated-guides) to map the same relative guide paths to project-local language directories. Missing variants fall back per page, with language status and localized search. Markdown/MDX trust, sanitization and shared source budgets apply to every locale.
