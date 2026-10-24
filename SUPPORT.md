# Support and release operations

The current distribution is [0.2.0-candidate.7](https://github.com/DavidNiessen/doctopus/releases/tag/v0.2.0-candidate.7), a prerelease with [verified installation and deployment evidence](docs/release-acceptance.md). It has no production support commitment or response-time guarantee. Independent security, isolation, accessibility, license reviews and external pilots remain deferred; a passing automated pipeline does not approve a stable launch.

## Supported configurations

| Component              | Current boundary                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Specifications         | OpenAPI 3.0.0–3.0.4 and 3.1.0–3.1.2, YAML/JSON, under the [documented compatibility limits](docs/openapi-compatibility.md)                                                                                                |
| CLI and Node adapters  | Node 24.22.1 or a compatible newer 24.x; Express 5 and Fastify 5. Use the pinned toolchain when contributing.                                                                                                             |
| Java and Spring        | Java 17/21/25, Spring Boot 3.5.16/4.1.1, MVC/WebFlux; see the [tested matrix and integration limits](docs/java-validation.md). Node, Studio and PostgreSQL are unnecessary in an application serving a built publication. |
| Static hosting         | Verified generated files at a root or subpath; private sites require a gateway protecting every file.                                                                                                                     |
| Publication server     | Linux amd64 container, PostgreSQL 17, single-host filesystem storage; see [deployment and recovery](docs/deployment.md).                                                                                                  |
| Other topologies       | Kubernetes is a starting template. Provider-specific ingress, multi-replica failover, PostgreSQL major upgrades and fully air-gapped installations require operator acceptance.                                           |
| Browsers and languages | Automated Chromium/Firefox/WebKit journeys; [core reader messages and authored guide locales](docs/internationalization.md). Real-device, independent accessibility and linguistic review are separate.                   |

Report failures using the exact distribution version, immutable image digest where relevant, deployment mode, toolchain and a minimal synthetic spec/config. Avoid sending private documentation, credentials, live responses, database dumps or customer data. The [bug form](https://github.com/DavidNiessen/doctopus/issues/new?template=bug.yml) requests reproduction and expected behavior. Feature proposals use the [feature form](https://github.com/DavidNiessen/doctopus/issues/new?template=feature.yml).

## Triage and ownership

[DavidNiessen](https://github.com/DavidNiessen), the initial maintainer named in [governance](GOVERNANCE.md), owns release monitoring, issue triage, incident coordination, publication decisions and rollback coordination. This is a single-maintainer project; no independent on-call rotation or guaranteed coverage is offered. Appointing a replacement or additional maintainer requires the public governance process.

Use the repository's existing labels:

- `bug` for incorrect behavior, with a minimal reproduction and the affected supported configuration.
- `documentation` for guides and examples; `accessibility` for barriers that can be described safely in public.
- `question` for usage questions; `enhancement` for proposed capabilities outside current behavior.
- `dependencies` and `github_actions` for the corresponding maintenance changes.
- `duplicate`, `invalid` and `wontfix` only with an explanation and a link or support-boundary reference where appropriate.
- `good first issue` and `help wanted` after the maintainer has confirmed scope and acceptance criteria.

Prioritize possible authorization bypass, private-content exposure, credential disclosure and data loss, followed by supported installation/publication failures, significant reader or integration regressions, then minor defects and enhancements. Suspected vulnerabilities go through [private reporting](SECURITY.md), including when first noticed in a public issue; do not publish exploit details in triage comments.

At maintenance review, inspect failed required main/PR checks, the daily dependency/container security workflow, weekly source analysis, protection drift and hosted demo checks. Retain affected versions, source/digests, reproducible evidence, assessment and corrective action. A green prior release does not waive a new advisory or failed scheduled check. Operational monitoring, alert delivery and backups for an installation belong to its operator.

## Fixes, releases and recovery

Prerelease fixes target the current accepted prerelease line on a best-effort basis. Older partial or failed candidates are not recommended installation targets. Publish a new immutable version for a correction; never overwrite artifacts, move release tags or describe a partial cross-registry publication as complete.

The stable security-maintenance policy in [SECURITY.md](SECURITY.md) requires a minimum 12-month window for the latest minor line and a migration path for older releases. No stable line is available yet. Announce the actual supported line, dates, migration notes and any compatibility changes with its stable release; do not infer a stable support period from this prerelease.

For a release incident, pause further promotion, identify the exact affected versions and preserve evidence. Reproduce on a controlled fixture, assess data/authorization impact, and communicate safe mitigations through the relevant public issue or private security advisory. The maintainer approves corrected source and original artifact digests through the protected workflows. Every required consumer must pass before announcing a complete distribution.

Operators can select a previous verified documentation publication without changing its immutable files. Server/database rollback follows the [tested fresh-target backup/restore and schema rollback procedure](docs/deployment.md#automated-schema-upgrade-and-rollback-rehearsal), using a compatible image and pre-upgrade recovery set. Never point an older executable at an incompatible schema. Verify private-file access, publication identity and recovery before switching traffic; site-specific recovery objectives remain the operator's responsibility.
