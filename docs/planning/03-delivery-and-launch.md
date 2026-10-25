# Delivery, quality, and open source launch plan

Status: implementation roadmap. Milestones are ordered by dependency and finish only when their exit gates pass. Implementation is underway. The README, compatibility matrix, operator documentation and tests identify current capabilities; milestone requirements and unchecked release gates remain binding.

## 1. Delivery strategy

Ship a narrow working vertical slice early: load YAML/JSON, render a polished endpoint page, search it, run a request against a mock API, and export a static site. Then expand correctness, integration, collaboration, and operations on the same architecture. Avoid spending months on abstractions before validating real reader workflows.

Use short-lived feature branches and small reviewed pull requests into the default branch. This repository uses **`master` as its main integration branch** to match the requested repository reference; “main pipeline” below means its pipeline. If maintainers rename it to `main`, update the default branch, rulesets, docs, release targets, and external links together.

Each completed implementation step gets a conventional commit and push. Do not push failing required checks as a completed milestone. Recommended examples: `feat(spec): resolve local OpenAPI references`, `fix(explorer): encode repeated query parameters`, `test(spring): verify context-path mounting`, `docs(operators): document restore procedure`, and `ci(release): add artifact provenance`.

## 2. Milestones and acceptance gates

### M0 — Repository and engineering foundation

Deliver the product/architecture contract, contributor workflow, a dependency lockfile, Prettier/ESLint/Markdown checks, feature/default-branch CI, PR title checks, and dependency automation. Establish the npm workspace, strict TypeScript config, package boundaries, architecture decision records, issue forms, license, community policies, and release ownership as implementation begins.

Exit: clean-checkout validation succeeds; an intentionally invalid formatting/lint/title change fails its relevant check; fork PR checks need no secrets; branch rules require review and stable check names. Current documentation automation is not a substitute for application typechecking or tests.

### M1 — Design system and working vertical slice

Deliver original visual tokens, responsive reader shell, navigation, guide/endpoint layouts, code panels, light/dark themes, and a CLI that accepts one YAML or JSON OpenAPI document. Pre-render pages, generate basic search, make an explorer request to a controlled mock API, and export a site that works under a subpath.

Exit: run the complete import → preview → request → static export journey in CI. No stub responses in the production explorer path. Review screenshots and keyboard flows at the agreed viewport sizes. Demonstrate deployment without a Node server.

### M2 — Standards-correct compiler and content

Deliver normalized graph/source maps, OpenAPI 3.0/3.1 compatibility fixtures, multi-file references, recursive/composed schemas, useful diagnostics, request/response examples, Markdown/MDX trust handling, stable URLs, redirects, and a versioned publication manifest. Establish adversarial input and scale fixtures early.

Exit: YAML/JSON equivalent fixtures render equivalent graphs; relative/recursive references terminate correctly; declared supported features render accurately; malformed or unsupported constructs produce explicit diagnostics. Spec example validation and deterministic build checks pass. A single changed schema invalidates all dependent output.

### M3 — Excellent API consumer experience

Deliver full request serialization, safe authentication state, selectable servers/content types, schema-aware forms, snippets in the five initial languages, local search ranking/sharding, guide components, navigation configuration, API versions, i18n infrastructure, and branding/theme customization.

Exit: snippets execute against a mock API; parameters match OpenAPI serialization fixtures; secrets do not appear in copied snippets or telemetry; theme presets pass accessibility review; 10k-page search and reader performance budgets are measured and pass or have an approved revised target with evidence.

### M4 — Plugin SDK and framework adapters

Deliver SDK hooks/manifests, capability documentation, compatibility checks, a conformance harness, and first-party source/snippet/theme examples. Implement generic Java assets, Spring Boot adapters, Express/Fastify adapters, and CLI recipes for other languages. Existing Spring/Node applications must have a bundled direct OpenAPI URL mode configured through framework-native settings, without a documentation project file or CLI build; retain optional prebuilt publications for authored portals.

Exit: fresh packaged sample applications run on the documented support matrix, including context paths, reverse proxies, authentication, and reactive/servlet behavior where advertised. A plugin authored using only public SDK docs passes the harness. Java production deployments require no Node runtime. Resolve the Spring Boot 3/4 artifact split using actual tests.

### M5 — Reliable self-hosted server

Deliver container/Compose distributions, PostgreSQL migrations, isolated build jobs, immutable artifact storage, publication/rollback, OIDC, role-based authorization, scoped publish tokens, audit logs, administrative project/release screens, health checks, and an explicitly configured relay.

Exit: private content cannot leak via route data, search, specs, asset URLs, caches, or redirects. Test login/logout/role revocation, interrupted builds, concurrent publication, relay SSRF restrictions, database outage, process shutdown, and recovery. Complete backup/restore and upgrade rehearsals with recorded results. Validate an offline installation from mirrored artifacts.

### M6 — Differentiation and release engineering

Deliver documentation doctor, contract diff with breaking-change classification, deprecation center, verified-snippet CI support, offline bundles, publication provenance, semantic release tooling, artifact signing/SBOM generation, package/container release workflows, and operator documentation.

Exit: a representative breaking change produces the expected diagnostics and migration links; doctor detects broken examples/references without requiring network access; release candidates install from built packages/JARs/images. Restore and rollback instructions are exercised from clean hosts. Publish no unsigned/unverified placeholders as release artifacts.

### M7 — Pilot, hardening, and 1.0 launch

Run Java, Node, and standalone pilots with external teams. Complete browser/accessibility testing, security review, dependency/license audit, load/scale tests, installation and upgrade rehearsals, and issue triage. Publish a polished demo built from the same public release, support matrix, changelog, roadmap, and complete user/operator/plugin documentation.

Exit: every applicable release checklist item below is complete, all advertised 1.0 capabilities have evidence, and release owners approve the exact tested artifact digests. Publish from protected tags/environment approvals. Monitor the release and prepare a tested rollback path.

### M8 — Post-1.0 expansion

Add browser-based editorial workflows, guided integration recipes, more framework adapters, rich version comparisons, optional analytics, additional API formats, and grounded AI integrations according to measured user demand. Stabilize each format's normalized model before claiming feature parity with OpenAPI. Preserve plugin and configuration compatibility during expansion.

## 3. Capacity and sequencing assumptions

Estimate by staffed milestone after M1 reveals the real complexity. An initial planning range for a dedicated team of 4–6 experienced engineers plus shared design, documentation, and security support is roughly **6–9 months to a hardened 1.0**; this is an estimate, not a commitment. A solo implementation is likely substantially longer. External identity-provider, signing, package-registry, and pilot-team lead times can dominate release scheduling.

M1 follows M0. M2 and M3 build on M1 and converge before plugin API freeze in M4. Server domain spikes can proceed after M2 contracts stabilize, while M5 depends on the compiler and artifacts from M2–M4. M6 requires real packaged integrations and the server. M7 follows all required gates. Design/accessibility/security work runs throughout, not only at the end.

Each milestone should be split into independently reviewable vertical increments, ideally one to three days of implementation each. Example for the Spring adapter: mount a prebuilt sample; support context paths; add security ordering; integrate springdoc discovery; add packaged matrix tests; document and publish a candidate. Commit and push each validated increment.

## 4. CI/CD design

Stable required check names are a public contract with branch protection. A final aggregate gate must fail if any required job fails, is cancelled, or is unexpectedly skipped. Avoid path filters that leave required checks pending; conditional jobs report a deliberate not-applicable outcome through the aggregate gate.

| Event                 | Pipeline behavior                                                                                                                                        | Security and publication policy                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Feature branch push   | Reproducible install, format/lint/typecheck, relevant unit/contract tests, production build                                                              | Read-only permissions; no release credentials                                                        |
| PR to default branch  | All feature checks plus conventional title, API/schema compatibility, integration tests, browser/a11y smoke, dependency review, changed package analysis | Untrusted fork code gets no secrets; no privileged `pull_request_target` checkout/execution          |
| Merge queue           | Required aggregate checks run on `merge_group`                                                                                                           | Test the candidate merge, not only the PR head                                                       |
| Default branch push   | Full tests, production build, packaged examples, deployability smoke, provenance-ready candidate artifacts                                               | Artifacts tied to commit SHA; no automatic stable release                                            |
| Optional PR preview   | Static preview of the PR artifact with expiry and visibly untrusted origin                                                                               | Sandboxed domain, no production auth/cookies; no privileged execution of untrusted build scripts     |
| Nightly/scheduled     | Full Java/Node/browser matrix, large fixtures, fuzzing, performance trend, vulnerability scans, backup/restore rehearsal where supported                 | Bounded resources, explicit owners for failures; never substitutes for required PR coverage          |
| Release PR            | Changeset/version/changelog validation, complete release matrix and package-content inspection                                                           | Maintainers review public API changes and migration notes                                            |
| Protected version tag | Verify tag/source, test exact candidate, generate SBOM/provenance, sign and publish npm/JAR/container/docs artifacts                                     | Short-lived OIDC credentials where supported; protected GitHub environment approval; least privilege |
| Security patch branch | Same relevant release gates, targeted regression, supported-version matrix                                                                               | Coordinated disclosure with private preparation where necessary                                      |

Before application packages exist, the executable pipeline intentionally runs only documentation/tooling checks. Add application jobs with the first real vertical slice; never use `--if-present`, empty test discovery, or `continue-on-error` to imply unimplemented suites passed.

### Reproducibility and supply-chain controls

- Pin Node/toolchain files, exact dependencies and lockfiles, wrapper distributions with checksum verification, GitHub Actions by full commit SHA, and release base images by digest.
- Use `npm ci` and corresponding frozen/wrapper commands. Cache dependencies by OS/toolchain/lockfile. Treat caches as acceleration, not trusted release evidence.
- Set job timeouts and concurrency cancellation for superseded feature/PR checks. Do not cancel an active artifact publication midway through a new release.
- Validate package contents, generated declarations, source maps, licenses, and browser/runtime entrypoints by installing tarballs/JARs/images in example consumers.
- Generate SBOMs, sign releases, attach provenance, verify artifact digests before promotion, and document verification for air-gapped operators.
- Review automated dependency updates with changelogs and compatibility tests. Alert on new vulnerabilities; do not auto-merge major upgrades.
- Redact secrets in logs; grant write/id-token permissions only to jobs that actually publish. Avoid long-lived personal tokens when workload identity is available.

### Repository settings required for launch

Files alone cannot activate all GitHub protections. Maintainers must configure and verify these settings before public launch:

1. Require PRs and review on `master`, with required quality checks, stale approval dismissal, resolved conversations, and no routine direct pushes/force pushes. Consider merge queue after `merge_group` checks are verified.
2. Restrict release tags and publishing environments; require approval for stable production publication. Grant bots only the package/repository capabilities they need.
3. Enable dependency alerts, secret scanning/push protection where available, private vulnerability reporting, and appropriate code scanning for the repository's GitHub plan and visibility.
4. Configure repository-bound GitHub Packages npm/Maven publication with short-lived Actions tokens, public package visibility, read-only authenticated consumers, GHCR and documentation deployment. The selected GitHub workflow does not require npm/Maven Central accounts or a production OpenPGP key. Keep any external consumer tokens in approved secret stores.
5. Set squash-merge conventions, default branch, issue templates, Discussions policy, repository description/topics, website/demo, and security contact routes.
6. Verify permissions using a contributor/fork PR and a dry-run release. Record the checks and date in the release checklist.

The initial planning commits are directly pushed as explicitly requested. Normal application development should use the protected PR workflow once maintainers enable it.

## 5. Test strategy and evidence

| Capability              | Required evidence                                                                                                 | Primary gate                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| OpenAPI correctness     | Fixtures for every supported keyword family, YAML/JSON parity, local/remote refs, cycles, encoding, invalid input | PR contract suite                                           |
| Reader quality          | Guide/endpoint/search/version/theme/browser flows and reviewed screenshots                                        | PR browser + a11y; full browser matrix nightly/release      |
| Explorer safety         | Real mock-server requests, OAuth test provider, secret-redaction checks, destructive-action confirmation          | PR integration suite                                        |
| Plugin extensibility    | First-party plugins using public hooks, incompatible-version rejection, fault/timeout cases                       | PR SDK suite                                                |
| Framework embedding     | Installed npm/JAR consumers with subpaths, host security, proxy prefixes                                          | PR representative adapters; full release matrix             |
| Private documentation   | Unauthorized direct artifact/search/spec access, cache partitioning, session/role changes                         | Required security integration suite                         |
| Publication reliability | Concurrent publish, interrupted build/upload, pointer rollback, cache consistency                                 | PR server integration; fault suite before release           |
| Operator readiness      | Fresh install, upgrade from supported version, backup and fresh-host restore                                      | Release rehearsal                                           |
| Performance             | Recorded fixtures/hardware/cold-warm behavior and regressions against budgets                                     | Lightweight PR budgets; stable scheduled/release benchmarks |
| Distribution            | Tarball/JAR/container inspection, signatures, SBOM, provenance, installation smoke                                | Release gate                                                |

Use the runner's real exit code and verify nonzero test counts where a test suite is required. Distinguish passed, failed, skipped, quarantined, and unrun checks. Every quarantine needs an owner, issue, expiry, and an explicit statement of the lost coverage; critical paths cannot be waived silently.

Retain test artifacts, traces on failure, accessibility reports, and benchmark metadata with bounded retention. Avoid storing live API payloads or tokens in recordings. Never test destructive actions against real customer APIs in CI.

## 6. Open source launch checklist

Checked items identify delivered implementation or documentation. Unchecked items remain required launch work. These checks do not replace exact-candidate acceptance or approve publication.

Owner decision on 2026-10-24: defer the independent security, isolation, accessibility, license reviews and external pilots for now and continue prerelease distribution acceptance. These items remain unchecked and are not completed reviews. [ADR 0002](../adr/0002-deferred-prerelease-reviews.md) records the decision; source policy permits the deferral only for prereleases. Automated severity, signature, repository-protection and fresh-consumer gates remain required. The final product name remains deliberately deferred by the owner.

### Project and community

- [ ] Adopt the final name and verify namespace/trademark availability.
- [x] Adopt Apache-2.0 and add project/browser notices; see [LICENSE](../../LICENSE), [NOTICE](../../NOTICE) and the distributed reader notices.
- [ ] Complete the independent dependency, font, icon, fixture and documentation license audit; adopted licensing and generated inventories do not replace this deferred review.
- [x] Add CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, governance/maintainer ownership, issue/PR templates, and support policies.
- [x] Define the inbound/outbound contribution policy without a mandatory CLA/DCO, public decision-making and succession in [governance](../../GOVERNANCE.md), and existing label/ownership conventions in [support](../../SUPPORT.md).
- [x] Publish feature/support matrices, prerelease status, roadmap and runnable examples: see [OpenAPI limits](../openapi-compatibility.md), [integrations](../integrations.md), [support](../../SUPPORT.md), [release acceptance](../release-acceptance.md) and [examples](../../examples/). The market-leading ambition remains an unverified goal.
- [x] Enable and verify repository protection and private vulnerability reporting settings.

### Product and documentation

- [ ] Complete all required 1.0 product scope or explicitly revise the contract before release.
- [x] Ship quickstarts for static hosting, Docker/Compose, private docs, Spring Boot, Express, and Fastify.
- [x] Ship [configuration/branding](../customization.md), [themes/layout](../reader-layout.md), [plugins](../plugins.md), [API compatibility](../openapi-compatibility.md), [authentication](../explorer-auth.md), [server operations](../server.md), [deployment/troubleshooting/recovery](../deployment.md) and [migration](../artifact-manifest.md) references.
- [ ] Verify the public demo against the exact released packages and include realistic large and small examples.
- [ ] Complete independent pilot journeys and close blocking usability, browser, and accessibility issues.

### Security and operations

- [ ] Review threat model, trust boundaries, XSS/SSRF protections, plugin isolation, and authorization across all artifact types.
- [ ] Verify no secrets in bundles, snippets, screenshots, logs, telemetry, or build artifacts.
- [x] Complete dependency/container/code scans for the accepted prerelease and [record findings](../security-triage.md); Medium findings remain visible and independent review remains deferred.
- [x] Test the shipped Caddy TLS template, non-root containers, filesystem permissions, resource limits and offline runtime in the declared [single-host acceptance](../deployment.md#disposable-server-container-acceptance); provider-specific topology acceptance remains the operator's responsibility.
- [x] Rehearse publication failures, fresh-target backup/restore and the supported historical schema upgrade/rollback in [deployment acceptance](../deployment.md); this does not validate arbitrary databases, topologies or disaster-recovery objectives.
- [x] Publish current supported configurations, best-effort prerelease maintenance, the stable security-window policy, vulnerability intake and [incident/release ownership](../../SUPPORT.md).

### Release evidence

- [x] All required prerelease candidate tests pass on the declared platform matrix: [22 candidate jobs](../release-acceptance.md#verified-workflows). Repeat for the stable candidate.
- [x] Meet unchanged compiler and cold mobile reader budgets on the documented [release fixtures](../release-acceptance.md#performance-and-installation-limits); lab measurements do not establish production capacity.
- [x] Verify versioned npm/Java/container/static subjects, SBOMs, checksums and producer/promotion attestations for [.7](../release-acceptance.md), including real registry consumption. Repeat for the stable candidate.
- [ ] Stable release uses reviewed tags and protected publication; release notes include migrations and known limitations.
- [x] Verify installation from published registries, not only local build output: [prerelease .7 acceptance](../release-acceptance.md) passed fresh npm/Maven and anonymous container consumers; repeat for the stable candidate.
- [x] Assign release monitoring, triage, incident and rollback coordination in [SUPPORT](../../SUPPORT.md); deployment monitoring and backup execution remain operator responsibilities.

## 7. Principal risks and mitigations

| Risk                                            | Mitigation and decision point                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Feature breadth delays a usable product         | Gate every milestone around a user journey; keep later formats, AI, visual editing, and extra adapters outside 1.0 |
| Standards edge cases create misleading docs     | Maintain compatibility fixtures and explicit diagnostics; establish parser evidence in M2                          |
| Visual ambition hurts accessibility or speed    | Agree tokens and budgets in M1; keep human accessibility review and bundle checks mandatory                        |
| Plugin API freezes too early                    | Implement several plugins through the SDK before stable v1; document deprecation/migration rules                   |
| Framework matrices grow without ownership       | Declare supported combinations, add packaged tests, and narrow scope before marketing unsupported variants         |
| Private data leaks through static artifacts     | Separate artifacts/policies and test direct access, search, caching, redirects, and revocation in M5               |
| Optional relay becomes an SSRF/open-proxy path  | Disable by default, enforce application and network policy, and validate adversarial destinations                  |
| Contributors cannot reproduce builds            | Pinned tools/locks, local equivalents of CI, fixture-only tests, and clean-checkout rehearsals                     |
| Multi-replica complexity undermines reliability | Launch with a proven single-instance topology; advertise high availability only after shared-state/failover tests  |
| Project lacks long-term maintenance capacity    | Clear maintainers, support window, triage cadence, dependency policy, and realistic published roadmap              |

## 8. Current next release step

The implementation has a [published, signed and registry-accepted prerelease](../release-acceptance.md). Keep its immutable version and evidence intact. Complete the explicitly deferred independent reviews and pilots before stable approval, resolve blocking findings, finalize naming and support commitments, and repeat all exact-candidate and protected publication gates for the stable version. Continue conventional commits and pushes for each validated increment; prerelease environment approval does not approve a future stable release.
