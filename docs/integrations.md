# Framework integrations

Spring Boot MVC/WebFlux, Express and Fastify support **direct OpenAPI mode**: install the integration, configure a specification URL and start your application. The UI is bundled with the integration. No `docs.config.yaml`, generated documentation directory or documentation CLI build is needed for that setup.

The [application quickstart](direct-integrations.md) covers exposing a spec, runtime titles, logos, prepared themes, layouts, appearance, security and source installation. Renamed packages remain unpublished; see [GitHub Packages](github-packages.md) for distribution status. The framework adapters display an existing specification; your application or an established generator supplies it.

## Express

Use Express 5. Expose your specification through an existing application route, then mount the UI:

```js
import express from 'express';
import { createExpressDocs } from '@davidniessen/doctopus-node/express';

const app = express();
// Your application supplies /openapi.json.
const docs = await createExpressDocs({
  url: '/openapi.json',
  title: 'My API',
  theme: 'violet',
  // authenticate: yourExistingAuthenticationMiddleware,
});
app.use(docs.mountPath, docs.router);
app.listen(8080);
```

The default mount is `/docs`; `mountPath: '/'` selects the root. Authentication runs before shell, asset and deep-link responses. Host-owned routes registered before a root-mounted router keep their own handling. Use `publicBasePath` when an enclosing router or trusted proxy adds a public prefix. The server does not fetch the specification; the browser loads it with same-origin credentials.

## Fastify

Use Fastify 5:

```js
import Fastify from 'fastify';
import { doctopusPlugin } from '@davidniessen/doctopus-node/fastify';

const app = Fastify();
// Your application supplies /openapi.json.
await app.register(doctopusPlugin, {
  url: '/openapi.json',
  title: 'My API',
  theme: 'violet',
  // authenticate: yourExistingOnRequestHook,
});
await app.listen({ port: 8080 });
```

Authentication hooks remain encapsulated within the plugin. A registration `prefix` is reflected in direct-mode UI URLs. Set `publicBasePath` for a different public reverse-proxy prefix. Both Node adapters expose `url`, `title`, `description`, `theme`, `layout`, `appearance`, `logo`, `logoDark` and `favicon`; see the [runtime options table](direct-integrations.md#runtime-options).

## Node request quotas

Both adapters limit documentation requests before authentication. Each adapter instance allows 600 requests per client per 60-second fixed window and remembers at most 10,000 clients. Assets, failed authentication and missing documentation paths count toward the quota. Excess requests receive an uncached `429` with `Retry-After`; when the client table is full, unknown clients are refused until the window resets. Active quotas are never evicted to admit new clients.

Configure either adapter with the same optional settings:

```js
const rateLimit = {
  maxRequests: 600,
  windowMs: 60_000,
  maxClients: 10_000,
};
```

Pass `rateLimit` alongside `url` or `directory` to `createExpressDocs` or `app.register(doctopusPlugin, ...)`. Settings must be safe integers: `maxRequests` from 1 to 1,000,000, `windowMs` from 1,000 to 86,400,000 and `maxClients` from 1 to 100,000. Invalid or unknown options fail startup. Neighboring IPv6 clients share a `/56` quota; IPv4-mapped IPv6 addresses use their corresponding IPv4 identity.

Configure the host framework's trusted proxies narrowly so its client IP represents the actual caller. Untrusted forwarded headers must not select the quota identity. Without proxy trust, users behind the same proxy share a quota. This in-memory limit is per adapter instance and process; deployments with replicas need a gateway policy for aggregate quotas. It does not replace network-level traffic protection. Host-owned Express routes registered before a root-mounted router, and Fastify routes outside the documentation plugin, retain their host policy.

## Spring Boot

The starter automatically chooses servlet MVC or reactive WebFlux. For an application that already uses springdoc, the default spec URL is the active context's `/v3/api-docs`. For an authored file in `src/main/resources/static/openapi.yaml`:

```yaml
doctopus:
  enabled: true
  url: /openapi.yaml
  path: /docs
  title: My API
  theme: violet
  layout: modern
  appearance: system
```

Open `/docs/` after starting the application. The JARs contain the Reader assets and their integrity inventory, fonts, notices and browser component inventory. No Node process or documentation project is required in a consuming Java application. The browser fetches the specification on a fresh page load. Titles, logos, prepared themes and initial layout/appearance are bound from normal Spring properties; restart the application to apply changed settings.

The [step-by-step quickstart](direct-integrations.md#spring-boot) covers the Maven dependency, specification exposure, optional branding and security. The starter includes generated IDE configuration metadata. Disable it with `doctopus.enabled=false`.

MVC uses `server.servlet.context-path`; WebFlux uses `spring.webflux.base-path`. Configure an explicit `url` with its public context prefix. When a proxy exposes another path, `doctopus.public-base-path` sets the external documentation mount. The starter keeps the host's security policy; apply it to the whole UI tree and protect the raw specification and API separately.

Spring Boot 3.5.16 and 4.1.1 are covered by the Linux JDK 17/21/25 matrix, compiling Java 17 bytecode. The installed-consumer runner verifies baseline-built JARs with isolated MVC-only/WebFlux-only classpaths. See [Java validation](java-validation.md).

## Optional prebuilt publication mode

Use this mode for a full documentation site with authored guides, compiled extensions, translations or a pinned publication. Build it with the CLI and a `docs.config.yaml` or JSON project configuration, then serve the complete immutable output:

```js
const docs = await createExpressDocs({
  directory: './documentation/.doctopus/site',
});
```

Fastify accepts the same `directory` option. For Spring:

```yaml
doctopus:
  enabled: true
  directory: /srv/documentation/site
  path: /docs
```

A directory selects prebuilt mode. Do not combine it with direct-mode options such as `url`, `title` or `theme`: startup rejects that ambiguity. Branding comes from the compiled publication. See [installation and publishing](installation.md).

The adapters verify the publication manifest and listed file digests at startup. Node retains its documented legacy-manifest compatibility; Java requires portable version 2. Only listed files and listed directory-index aliases are public. Extra files, symlinks and the manifest itself are not automatically served. Keep the directory immutable while serving it; startup verification does not lock or rehash files on every request.

The compiled `basePath` must match the public mount. For Spring, include the active context prefix plus `doctopus.path`; set `doctopus.public-base-path` when a trusted reverse proxy uses a different external prefix. A mismatch fails startup. `doctopus.path: /` hosts a root publication; use an empty compiled base path for an origin root or the context prefix for a context-root deployment. Host-owned controllers and functional routes retain their handling.

Optionally pin a Java publication with `doctopus.artifact-digest`; a mismatch fails startup. An artifact digest requires prebuilt mode. Replace the publication immutably and restart the application to deploy an update. See [manifest verification and migration](artifact-manifest.md).

For a generated spec in this optional build workflow, [import a local snapshot](remote-import.md#spring-boot-and-other-local-generators) before building. Direct mode does not require that import step.

## Generic Java

`doctopus-core` provides `DirectDocumentation` for configuring the bundled Reader and obtaining shell/asset bytes, and `Publication` for verified filesystem publications. A servlet, JAX-RS service or another framework can integrate either with its own HTTP and authentication handling. The core library includes no embedded server or JavaScript engine. Spring's starter supplies ready-made HTTP handling for both modes.

## Other languages and runtime environments

Other runtimes can serve a compiled static artifact through an existing authenticated file server, reverse proxy or resource handler. The manifest and site configuration are portable JSON. Native adapters for Python, Go, .NET and other runtimes remain roadmap work; current direct adapters cover Spring Boot, Express and Fastify.
