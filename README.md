# Doctopus

![Doctopus](assets/brand/doctopus-wordmark.svg)

**Give your API a helping hand.**

An open source, self-hosted API documentation platform: polished documentation, interactive API references, and framework integrations without a required hosted service.

Start with the [application quickstart](docs/direct-integrations.md) for Spring Boot/Node integration, or the [installation and usage guide](docs/installation.md) for a standalone site, static hosting and the optional management platform.

**Status: prerelease development.** Doctopus is the new name of this project. The renamed source includes the OpenAPI compiler, React reader, worker-based search, interactive API explorer, CLI, optional publication server and Studio, plus Java/Spring Boot/Node integrations. The last published prerelease, [0.2.0-candidate.7](docs/release-acceptance.md), uses legacy coordinates and predates this rename. Renamed packages have not yet been published. See the [rename and migration guide](docs/migration-doctopus.md).

The owner has [deferred independent launch reviews and pilots for prereleases](docs/adr/0002-deferred-prerelease-reviews.md). Those reviews remain unfinished; automated checks and protected registry installation acceptance remain required. This deferral is not a stable production release approval.

Try the [GitHub Pages demo](https://doctopus.niessen.dev/): bundled mock responses run entirely in your browser, with no API server or credentials. See [demo deployment and local preview](docs/pages-demo.md).

Build Doctopus from source using the commands below, or consult [GitHub Packages and GHCR](docs/github-packages.md) for the publication status and archived prerelease installation. npm/Maven installation requires GitHub authentication; running generated static documentation requires no account. Independent reviews and stable production approval remain open.

## Product direction

- Import OpenAPI in YAML or JSON and combine generated reference pages with authored guides.
- Deliver a refined reading experience with extensive branding, accessible components, and fast navigation.
- Publish to static hosting or run a self-hosted server for authentication, editing, publishing, and team workflows.
- Integrate through versioned plugins, including Java/Spring Boot and JavaScript/TypeScript frameworks.
- Keep core authoring, hosting, search, authentication, and customization available in the open source product.

## Plan

1. [Product specification](docs/planning/01-product.md): scope, visual direction, features, and measurable launch requirements.
2. [Architecture and engineering design](docs/planning/02-architecture.md): stack, package boundaries, plugin contracts, integrations, and security.
3. [Delivery and open source launch](docs/planning/03-delivery-and-launch.md): phased implementation, CI/CD, release gates, risks, and the launch checklist.
4. [Implementation progress](docs/planning/04-progress.md): current estimate, completed capabilities, validation and remaining launch work.

## Add API docs to your application

For Spring Boot, Express and Fastify, direct mode bundles the Reader and loads your specification URL in the browser. **No `docs.config.yaml`, documentation CLI build, publication directory, Studio or database is required.** See the [application integration quickstart](docs/direct-integrations.md), including source installation while renamed packages remain unpublished.

Spring Boot (`application.yml`):

```yaml
doctopus:
  url: /v3/api-docs
  title: My API
  path: /docs
  theme: violet
```

Express:

```js
const docs = await createExpressDocs({
  url: '/openapi.json',
  title: 'My API',
});
app.use(docs.mountPath, docs.router);
```

Fastify accepts the same settings through `app.register(doctopusPlugin, options)`. Your application or an existing generator supplies the spec endpoint. Open `/docs/` after starting the application. Titles, logos, prepared themes, initial layout and appearance use application settings. Java consumers of the bundled artifacts need no Node installation.

## Run the example

Use Node.js from `.node-version` and pnpm 11.25.0 (`npm install --global pnpm@11.25.0`):

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build
pnpm run demo:build
pnpm run demo:serve
```

The documentation server listens on port 3000. In a second terminal, run `npm run demo:api` to start the local API on port 4010. Use the public fixture token `demo-token` in the playground. These are local demonstration services.

## Build an optional standalone site

```sh
node packages/cli/dist/main.js init my-docs
node packages/cli/dist/main.js build my-docs
node packages/cli/dist/main.js serve my-docs/.doctopus/site
```

Edit `docs.config.yaml`, point it to your YAML or JSON OpenAPI document, and add Markdown guides. Copy the generated `.doctopus/site` folder to any static host. Multi-file remote specs can use [pinned offline reference snapshots](docs/reference-snapshots.md). See the [CLI reference](docs/cli.md), [OpenAPI compatibility](docs/openapi-compatibility.md), [guide authoring](docs/authoring.md), and [branding and SEO](docs/customization.md), and [deprecations and migration guidance](docs/lifecycle.md), and [core reader UI translations](docs/internationalization.md).

## Repository checks

Use the pinned Node.js and pnpm versions:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run check
pnpm run demo:build
pnpm exec playwright install chromium
pnpm run test:e2e
```

Prettier, ESLint, and Markdown linting run on feature branch pushes, pull requests, merge queue candidates, and `master`. PR titles use conventional commit format. Strict TypeScript checks, compiler/security unit tests, deterministic publication checks, browser workflows, and automated accessibility checks also run in CI. See [CONTRIBUTING](CONTRIBUTING.md).

See the [interface tour](docs/design/interface.md) and the [Doctopus brand guide and logo kit](docs/branding.md).

## Project principles

The documentation must work without an account with the project maintainers. Deployments own their content, credentials, configuration, and artifacts. Public documentation should remain readable when optional services fail. Accessibility, security, upgrade safety, and performance are release requirements.

Doctopus uses its own components, branding, assets, and copy to create a cohesive documentation experience.

Readers can choose modern documentation or a classic API layout, select prepared theme presets with matching response-editor colors, and filter the sidebar with All, Documentation and API Reference. See [reader settings and layouts](docs/reader-layout.md#personal-reader-settings).

## Self hosting and project policy

See the [server configuration](docs/server.md), [Studio build controls](docs/studio-builds.md), [separate build worker](docs/build-worker.md), [container deployment and recovery](docs/deployment.md), [framework integrations](docs/integrations.md), [trusted build plugins](docs/plugins.md), [candidate packaging](docs/releases.md), and [measured performance](docs/performance.md). Code is licensed under [Apache-2.0](LICENSE); see [NOTICE](NOTICE), [security reporting](SECURITY.md), [support and release operations](SUPPORT.md), [governance](GOVERNANCE.md), and the [code of conduct](CODE_OF_CONDUCT.md).
