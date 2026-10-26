# Add an API reference to your application

Direct mode serves the bundled Doctopus Reader from your existing application. The browser loads your OpenAPI YAML or JSON document when the page opens. Configure the integration through Spring properties or Node options: **no `docs.config.yaml`, documentation CLI build, generated publication directory, Studio or database is needed.**

The integration serves the UI. Your application or an existing OpenAPI generator supplies the specification and implements the API itself.

**Package availability:** these instructions describe the current source checkout. The renamed packages are not published yet. Until they are released, follow [source installation](#source-installation) once to install the development artifacts. Published Java artifacts bundle the browser assets; consuming them needs no Node.js installation. A Node application needs its normal Node runtime, with no separate documentation build.

## Spring Boot

Use the Spring starter with an existing MVC or WebFlux application. The same starter detects the active web stack. The [tested Java matrix](java-validation.md) covers JDK 17, 21 and 25 with Spring Boot 3.5.16 and 4.1.1.

### Add the dependency

Add this to your application's POM after installing the source artifacts, or use the corresponding published version when available:

```xml
<dependency>
  <groupId>dev.niessen</groupId>
  <artifactId>doctopus-spring-boot-starter</artifactId>
  <version>0.2.0-candidate.7</version>
</dependency>
```

### Expose your specification

If you already use springdoc, keep its `/v3/api-docs` endpoint. The starter uses that endpoint by default, including the active application's context prefix.

For an authored specification, put `openapi.yaml` in `src/main/resources/static/`. Spring Boot's ordinary static-resource handling exposes `/openapi.yaml`. JSON works too: use `openapi.json` and its corresponding URL. The specification should be self-contained; local `#/...` references are supported.

### Configure the UI

In `src/main/resources/application.yml`:

```yaml
doctopus:
  enabled: true
  url: /openapi.yaml
  path: /docs
  title: My Company API
  description: API reference for my application.
  theme: violet
  layout: modern
  appearance: system
```

Or use `application.properties`:

```properties
doctopus.enabled=true
doctopus.url=/openapi.yaml
doctopus.path=/docs
doctopus.title=My Company API
doctopus.theme=violet
doctopus.layout=modern
doctopus.appearance=system
```

Start your application normally. For a local app on port 8080, open [http://localhost:8080/docs/](http://localhost:8080/docs/). The header uses `title`; without it, the Reader uses the OpenAPI `info.title`. Browser-tab titles combine the active operation and site name.

Restart the application to apply changed integration settings. Specification changes are fetched on a fresh page load without compiling or publishing a documentation site.

### Optional branding

Serve your images through your application, then configure their public URLs:

```yaml
doctopus:
  url: /openapi.yaml
  title: My Company API
  logo: /brand/logo.png
  logo-dark: /brand/logo-dark.png
  favicon: /brand/favicon.png
```

A dark logo requires a default logo. Use same-origin or HTTPS image URLs. The response editor follows the selected theme automatically.

### Context paths, proxies and security

For `server.servlet.context-path: /gateway` or `spring.webflux.base-path: /gateway`, the UI is exposed at `/gateway/docs/`. For an explicit specification URL, include its public prefix, for example `doctopus.url: /gateway/openapi.yaml`. An omitted URL defaults to the context-prefixed springdoc endpoint.

When a trusted reverse proxy adds another prefix, set `doctopus.public-base-path` to the externally visible documentation path and configure `url` for the externally visible specification endpoint. Assets and internal navigation use the public documentation path.

The integration keeps your application's security policy. Apply the intended rules to `/docs`, `/docs/**`, the raw specification and the actual API. Protect the whole documentation tree, including scripts and fonts. For public documentation, add an appropriate `permitAll` matcher before your existing catch-all rule. Direct mode does not generate or automatically expose a protected specification.

## Express

Use Express 5 and Node.js 24.22.1 or the compatible version declared by the package. Install `@davidniessen/doctopus-node` from your configured registry when published, or use the source-built archives below.

```js
import express from 'express';
import openapi from './openapi.json' with { type: 'json' };
import { createExpressDocs } from '@davidniessen/doctopus-node/express';

const app = express();
app.get('/openapi.json', (_request, response) => response.json(openapi));

const docs = await createExpressDocs({
  url: '/openapi.json',
  title: 'My Company API',
  theme: 'violet',
  layout: 'modern',
  appearance: 'system',
  // authenticate: yourExistingAuthenticationMiddleware,
});
app.use(docs.mountPath, docs.router);
app.listen(3000);
```

Open [http://localhost:3000/docs/](http://localhost:3000/docs/). `mountPath` defaults to `/docs`; use `/` for an origin-root UI. Register host-owned routes before a root-mounted documentation router. If another application router or reverse proxy adds a prefix, set `publicBasePath` to the full external documentation mount.

The authentication middleware applies to the shell, assets and deep links. Your application separately controls access to `/openapi.json` and its API routes. The adapter retains its [request quotas](integrations.md#node-request-quotas), including in direct mode.

## Fastify

Use Fastify 5:

```js
import Fastify from 'fastify';
import openapi from './openapi.json' with { type: 'json' };
import { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';

const app = Fastify();
app.get('/openapi.json', async () => openapi);
await app.register(doctopusPlugin, {
  url: '/openapi.json',
  title: 'My Company API',
  theme: 'violet',
  layout: 'modern',
  appearance: 'system',
  // authenticate: yourExistingOnRequestHook,
});
await app.listen({ port: 3000 });
```

Open [http://localhost:3000/docs/](http://localhost:3000/docs/). The plugin accounts for a Fastify registration `prefix` in its UI URLs. Set `publicBasePath` when the public proxy path differs. Authentication hooks remain encapsulated within the plugin; host-owned routes retain their own policy.

## Runtime options

| Spring property             | Node option                  | Meaning                                                                                      |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| `doctopus.url`              | `url`                        | Public OpenAPI URL; Spring defaults to its context's `/v3/api-docs`, Node to `/openapi.json` |
| `doctopus.title`            | `title`                      | Header title and tab-title site name; defaults to the spec title                             |
| `doctopus.description`      | `description`                | Site description; defaults to the spec description                                           |
| `doctopus.path`             | `mountPath`                  | Application mount; defaults to `/docs`                                                       |
| `doctopus.public-base-path` | `publicBasePath`             | Full external UI path when a proxy adds a prefix                                             |
| `doctopus.theme`            | `theme`                      | Prepared `violet`, `mint`, `ocean` or `neutral` theme                                        |
| `doctopus.layout`           | `layout`                     | Initial `modern` or `classic` layout                                                         |
| `doctopus.appearance`       | `appearance`                 | Initial `system`, `light` or `dark` appearance                                               |
| `doctopus.logo`             | `logo`                       | Public default-logo URL                                                                      |
| `doctopus.logo-dark`        | `logoDark`                   | Public dark-logo URL; requires the default logo                                              |
| `doctopus.favicon`          | `favicon`                    | Public favicon URL                                                                           |
| `doctopus.enabled`          | Register or omit the adapter | Enable/disable the Spring integration                                                        |

Visitor preferences override the initial layout and appearance after a visitor makes a choice. The visual Theme switcher selects a complete palette; editor colors follow it. Default system appearance selects the theme's matching light or dark variant automatically. Configuration IDs remain `violet`, `ocean`, `mint` (Forest) and `neutral` (Graphite). Runtime settings are evaluated when the integration starts; they are not an application-property hot-reload mechanism.

The public configuration is sent to the browser. Keep private secrets out of URLs and branding settings. The spec request uses same-origin browser credentials; cross-origin documents need appropriate CORS and do not receive your application's cookies through this loader. The Java and Node servers do not fetch the configured specification themselves.

The loader accepts self-contained OpenAPI 3.0/3.1 JSON or YAML, with bounded parsing and local references. It caps the source response at 16 MiB, the overall load at 30 seconds, and worker parsing/normalization at ten seconds. It provides delayed loading skeletons and retryable errors. External reference graphs need bundling before use. The browser must have JavaScript enabled.

## Optional prebuilt publications

Use [static publication mode](installation.md) when you need authored guides, build plugins, translated guide trees, frozen external references or a separately generated documentation portal. That workflow uses `docs.config.yaml` or its JSON equivalent and the CLI at build time.

Selecting `doctopus.directory` or Node's `directory` chooses prebuilt mode. The integration verifies and serves the complete immutable publication. Its branding comes from the publication; direct-mode options such as `url`, `title` and `theme` cannot be combined with `directory`. An `artifact-digest` pin also requires a prebuilt publication.

## Source installation

Until renamed distributions are published, build this checkout with the pinned Node/pnpm versions as described in [installation](installation.md#install-the-tools). This is a one-time library build, separate from building documentation for an application.

For Java, after the workspace build:

```sh
node scripts/prepare-java-fixture.mjs
cd integrations/java
./mvnw --batch-mode --no-transfer-progress --strict-checksums install
```

The Reader's UI, workers, fonts, notices and browser component inventory are bundled into the core JAR. Java consumers need those JARs and their normal Maven dependencies, with no documentation output directory or Node process.

For Node, pack the public workspace artifacts:

```sh
export DOCTOPUS_PACK_DIR="$(node scripts/pack-npm.mjs)"
printf '%s\n' "$DOCTOPUS_PACK_DIR"
```

In a separate npm-based application, install the generated archives together so unpublished internal dependencies resolve locally, along with your web framework:

```sh
npm install --ignore-scripts "$DOCTOPUS_PACK_DIR"/*.tgz express@5
```

Use `fastify@5` instead for Fastify. Registry authentication and archived distributions are covered by [GitHub Packages](github-packages.md). A version string in the source tree does not establish registry availability.
