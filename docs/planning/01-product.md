# Product specification

Status: proposed product contract. All capabilities are planned unless the repository explicitly marks them implemented. Working name: **doctopus**; final naming and trademark checks precede public launch.

## 1. Mission and position

Build the most compelling self-hosted API documentation experience for teams that want excellent presentation, complete ownership, and reliable integration with their existing development workflow. Compete through measurable usability, correctness, speed, customization, and operational quality. “Best on the market” is an ambition to validate through comparative research and user testing, not a launch claim.

The primary audiences are API consumers learning and debugging integrations, developers maintaining API contracts, technical writers authoring guides, and operators hosting internal or public documentation.

Primary journeys:

1. A developer points the CLI at `openapi.yaml`, previews a branded site, and exports a deployable static bundle.
2. A Spring Boot team adds a starter, uses its existing springdoc endpoint, and serves documentation under `/docs` without running Node in production.
3. A TypeScript team mounts a middleware adapter or publishes in CI from a generated specification.
4. A reader finds an endpoint, understands authentication and schemas, runs a safe example, and copies usable code in their language.
5. A maintainer previews a spec change, reviews breaking changes and documentation quality, then publishes an immutable, reversible release.
6. An organization hosts private documentation with SSO, access controls, audit history, backups, and no mandatory outbound services.

## 2. Product boundaries and release scope

**1.0 means a complete, supportable product for the declared scope.** It includes installation, upgrades, useful diagnostics, documentation, accessibility, recovery procedures, and supported integrations. It does not mean every ecosystem adapter or speculative feature is finished.

| Area                   | Required for 1.0                                                                         | Subsequent expansion                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| API formats            | OpenAPI 3.0.x and 3.1.x, YAML and JSON, local multi-file references                      | Swagger 2 import/migration; AsyncAPI; GraphQL; gRPC               |
| Content                | Markdown, trusted MDX, reusable components, assets, navigation, API-to-guide links       | Visual authoring, translation integrations                        |
| Reader experience      | Search, dark/light mode, responsive navigation, API explorer, snippets, version switcher | Multi-spec explorer workspaces, rich tutorials                    |
| Hosting                | Static export, Docker server, documented Kubernetes deployment                           | Managed hosting as an optional separate distribution              |
| Integrations           | Spring Boot starter, generic Java assets, Express/Fastify adapters, CLI/CI               | Next.js helper, NestJS, Python, Go, .NET adapters                 |
| Collaboration          | Git workflow, previews, roles, server publish history and rollback                       | Browser editor with review workflow, editorial scheduling         |
| Enterprise foundations | OIDC SSO, project/version permissions, audit trail, scoped publish tokens                | SAML via identity broker, SCIM, multi-organization administration |
| Intelligence           | Deterministic contract checks and search                                                 | Optional grounded AI answers and migration assistance             |

Unsupported constructs must produce actionable diagnostics rather than silently rendering misleading documentation. Publish a compatibility matrix and known limitations with every release.

## 3. Visual and interaction direction

The UI should provide clear information density, generous spacing, precise typography, intuitive navigation, and readable API examples. Use independently created components and design assets; no copied source, logos, proprietary illustrations, or misleading affiliation.

### Desktop composition

- A restrained sticky header with project identity, a prominent search trigger, utility links, version selector, and theme control.
- A roughly 240–272 px left navigation column with groups, nesting, subtle active states, endpoint method badges, and collapsible sections.
- A centered reading column with a comfortable 65–75 character measure, generous vertical rhythm, breadcrumbs, a clear page title, and short introductory copy.
- A roughly 280–360 px right context column for page contents on guides and sticky request/response examples on endpoint pages. API pages may use a wider content grid; long schemas must not crush the reader column.
- Fine borders, soft surface contrast, minimal shadows, rounded panels, clean icons, and one restrained brand accent. Typography pairs a highly legible sans serif with a technical monospace; self-host all font assets.
- Code blocks with language tabs, copy buttons, line emphasis, wrap controls, and accessible overflow behavior. Request and response panels use consistent syntax colors in both themes.

### Responsive and accessible behavior

- At tablet widths, convert the right column into inline content or a drawer; at phone widths, use one column with accessible navigation and search sheets.
- Keep reading position when opening navigation or changing example language. Preserve meaningful hash links for headings, parameters, and schema properties.
- Support keyboard-only operation, visible focus, skip links, screen readers, zoom to 200%, high contrast, and reduced motion. Target WCAG 2.2 AA and manually test the core journeys.
- Use calm transitions of approximately 120–180 ms where useful, disabled under reduced motion. No animation is required to understand state.
- Provide designed loading, empty, error, offline, permission-denied, and no-search-results states. Color is never the sole carrier of HTTP method, validation, or status information.
- Never trap vertical page scrolling inside tall code samples. Virtualized schema trees need an accessible alternative and stable deep links.

### Theme system

Offer production-ready presets and validated design tokens for brand colors, typography, spacing, density, radii, surfaces, logo variants, sidebar styles, code themes, and endpoint layout. Readers select a prepared theme or the published branding; response-editor colors follow that selection and light/dark appearance automatically. Custom palette editors, saved personal themes and independent editor-theme controls are excluded. Project branding remains available through validated YAML/JSON configuration, with contrast checks during build and doctor validation.

Allow configuration overrides, scoped CSS, component slots, and fully custom React themes at progressively higher trust levels. Document token precedence, supported extension points, schema migration, and compatibility guarantees. Default themes must remain attractive without tuning.

Visual acceptance: review representative guide, endpoint, schema, search, and mobile pages in both themes at 360, 768, 1280, and 1920 px widths. Use screenshot baselines, automated accessibility checks, and human review. Evaluate visual consistency, readability, and working interactions across the product.

## 4. API specification and reference experience

- Accept local files, configured HTTPS URLs, or framework-generated OpenAPI documents. YAML and JSON must produce equivalent normalized output.
- Resolve relative local references, preserve source locations, and support configured remote reference origins with size, depth, time, and network restrictions.
- Explain parse and validation errors with file, line/column when available, reference chain, and suggested next action. Avoid stack traces as primary user feedback.
- Render paths, operations, parameters, serialization styles, request bodies, media types, responses, headers, security requirements, examples, enums, defaults, constraints, deprecation, external docs, and reusable schemas.
- Correctly represent `allOf`, `oneOf`, `anyOf`, discriminators, nullable semantics, recursive schemas, and relevant OpenAPI 3.1 JSON Schema dialect behavior. Identify unsupported keywords explicitly.
- Render callbacks and webhooks as documented concepts with payload examples; interactive callback execution is outside 1.0.
- Support multiple APIs and API versions per site, operation-level guide links, lifecycle banners, and schema property anchors.
- Separate API lifecycle versions from product package versions and documentation publication IDs. Preserve stable URLs and allow explicit redirects on renamed operations.
- Build a source map from rendered output to the original spec, enabling “edit this page,” diagnostics, and spec review annotations.
- Add spec coverage reports: missing descriptions, undocumented errors, missing examples, inconsistent tags, ambiguous authentication, and stale links. Rules have severity and narrow, justified suppressions.

## 5. API explorer and executable examples

- Generate editable requests from operation metadata with server selection, parameter editors, content-type selection, and schema-aware body templates.
- Support API keys, HTTP basic/bearer authentication, OAuth2 authorization-code flow with PKCE, and user-provided tokens. Explain when OAuth requires provider registration; never ask a browser to keep a client secret.
- Keep reader credentials in memory by default and clear them on sign-out/project changes. Explicitly opt into session persistence; never put credentials in URLs, rendered HTML, analytics, exported examples, or logs.
- Show the exact method, destination, headers, and body before execution. Requests execute only after a user action. Mark operations that may change data; require an additional confirmation for destructive operations by default.
- Display response status, latency, headers, formatted/ raw body, truncation, and download options with redaction controls. Bound response sizes and abort slow requests.
- Generate tested snippets for cURL, JavaScript fetch, TypeScript, Python, and Java first. Plugin-based generators add C#, Go, Kotlin, and runtime-specific SDK examples later.
- Copy examples with placeholders for sensitive fields. Allow shareable, sanitized request templates; reject secrets in share links.
- Default to direct browser requests. When target CORS policy prevents access, explain the issue and offer a copyable request. An optional server relay requires explicit operator configuration and destination allowlists.
- Provide deterministic mock responses generated from examples, with seedable synthetic data as a fallback. A persistent mock API server is a later capability, not an implicit production endpoint.

## 6. Guides, navigation, discovery, and content ownership

- Author Markdown guides and trusted MDX with tabs, steps, callouts, cards, accordions, API links, schema embeds, and code groups.
- Treat source content as portable files. Export projects without vendor-specific database dependence. The optional server stores operational metadata, not the sole copy of authored content.
- Provide validated project configuration, multiple navigation groups, reusable snippets, explicit redirects, canonical URLs, sitemap, robots controls, social metadata, and RSS/changelog feeds.
- Implement fast local search with title/heading/body/operation/parameter weighting, typo tolerance, keyboard navigation, contextual excerpts, and filters for API, version, tag, and language.
- For private docs, search and generated artifacts must enforce the same authorization as page requests. Exclude protected content from public search indexes and sitemaps.
- Support internationalized UI and locale-aware routing in 1.0, with translation status and fallback behavior. Full automatic content translation is optional and later.
- Offer page feedback and broken-example reporting through an optional server module or a configured external issue link; static deployments need no analytics service.

## 7. Useful differentiators

| Feature                        | Why it helps                                                                                               | Delivery                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Contract change review         | Classifies breaking changes, links affected operations and guides, and suggests migration checklist items  | 1.0                                       |
| Documentation doctor           | One command checks references, examples, routes, links, configuration, and content quality                 | 1.0                                       |
| Verified snippets              | Executes representative generated snippets against a controlled test API and exposes the test date/version | 1.0 CI fixtures; opt-in for user projects |
| Offline documentation bundle   | Search and reference remain available on disconnected networks without external fonts or scripts           | 1.0                                       |
| Reproducible publication       | A build manifest records inputs, plugin versions, warnings, and output digests for review and rollback     | 1.0                                       |
| Audience-aware navigation      | Presents public, partner, and internal documentation with matching artifact isolation and access policy    | 1.0 server mode                           |
| Deprecation center             | Summarizes API removals, deadlines, affected snippets, and migration guides                                | 1.0                                       |
| Guided integration recipes     | Walks users through linked operations with variables and mock state before production execution            | After 1.0                                 |
| Cross-version comparison       | Side-by-side endpoint/schema changes and version-aware search                                              | After 1.0; basic diff in 1.0              |
| Optional AI answers            | Cites authorized pages and exact API versions; supports local models or operator-provided providers        | After 1.0                                 |
| Documentation health dashboard | Tracks missing content, unsuccessful searches, and feedback without collecting request credentials         | After 1.0                                 |

Optional AI must never be required to build, search, or read docs. Treat retrieved content as untrusted, enforce authorization before retrieval, provide citations and uncertainty, and never execute API calls automatically. Operators control retention and outbound access.

## 8. Deployment and integration promises

### Static distribution

Produce pre-rendered HTML, local assets, a search index, and an explicit build manifest. Deploy on any ordinary static web server, at a root or subpath, without a database or a Node process. Readable content survives JavaScript failure; explorer and search progressively enhance it. Private static hosting requires a trusted authentication gateway that protects every artifact, not only HTML routes.

### Self-hosted server

Provide a non-root container and Docker Compose configuration with PostgreSQL for operational data. Support project administration, OIDC, publishing, scoped access, audit events, and an optional API relay. The public reader can serve the last healthy artifact even when a build fails. Document TLS termination, proxy headers, storage, backups, upgrades, and recovery.

### Framework plugins

The Java/Spring Boot and JavaScript integrations configure routes, asset serving, spec discovery, and framework lifecycle behavior. They use the same renderer and configuration contract as standalone deployments. Core documentation features must not fork into separate implementations per language.

Support Java 17/21/25 and Spring Boot 3/4 as a proposed target matrix to verify during adapter work; split artifacts if framework baselines require it. For Node, test the active supported LTS lines selected at implementation time. Record exact minimum versions and end-of-support policy before calling an adapter stable.

## 9. Quality targets and evidence

These are proposed release budgets, not current benchmark results. Establish repeatable hardware, browser, fixtures, cache conditions, and measurement scripts before judging them. Record medians and p95 where applicable, with sample counts and variance.

| Dimension         | Initial target and test conditions                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First load        | Public guide and endpoint pages: lab LCP ≤ 2.5 s, CLS ≤ 0.1 under a documented mid-tier mobile/4G profile; use field p75 when available                  |
| Interaction       | Reader interactions ≤ 200 ms p95 in scripted tests; field INP p75 ≤ 200 ms when telemetry is enabled                                                     |
| JavaScript        | Initial guide route ≤ 150 KiB gzip; endpoint route ≤ 220 KiB before opt-in explorer/editor bundles; report first-party JS separately from other assets   |
| Search            | Warm local query ≤ 100 ms p95 on a 10,000-page fixture; cold index fetch separately measured and sharded                                                 |
| Scale             | Build 10,000 operations / 50,000 schema nodes within 120 s and 2 GiB peak RSS on a documented 4-vCPU Linux runner; no recursive expansion blowups        |
| Incremental build | Single-guide update ≤ 2 s p95 on the same fixture after a warm full build                                                                                |
| Server            | Static document delivery p95 ≤ 100 ms at 100 requests/s on a documented 2-vCPU/2-GiB instance with a warm artifact cache; measure auth routes separately |
| Accessibility     | No critical/serious automated violations on core routes; manual keyboard and screen-reader journeys pass WCAG 2.2 AA review                              |
| Correctness       | Required OpenAPI fixture matrix, snippet execution checks, framework contract tests, and link checks pass                                                |
| Recovery          | Tested database + artifact restore with default-target RPO ≤ 24 h and RTO ≤ 60 min on a documented dataset; operators choose stricter schedules          |
| Security          | No untriaged critical/high findings in the release threat model and dependency/container scans; exceptions require written owner and expiry              |

A 99.9% availability deployment objective is possible only with an operator's infrastructure, redundancy, and monitoring. It is not a guarantee from a software repository. Publish reference sizing and observed failure behavior instead of unsupported uptime claims.

## 10. Definition of a successful launch

A fresh user can install, import a nontrivial spec, customize branding, publish, integrate a supported framework, authenticate private readers, upgrade, and restore a backup using only the shipped documentation. Core flows work in current Chrome, Firefox, Safari, and Edge, with phone and keyboard access.

At least three external pilot teams should complete representative Java, JavaScript, and standalone deployments. Document their issues and close launch-blocking defects. Compare onboarding time, correctness, accessibility, search, customization, and performance against current alternatives using disclosed versions and scenarios.

Every advertised 1.0 feature must have a working implementation, user documentation, an owner, meaningful tests, and a support boundary. Features that miss the gate are explicitly deferred or delay the release; they are never represented by a placeholder UI.
