# Security policy

## Supported versions

The project is in pre-release development. No version currently carries a production support commitment. Stable releases will document a minimum 12-month security maintenance window for the latest minor line and a published migration path for older releases.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/DavidNiessen/doctopus/security/advisories/new) when it is enabled. If GitHub does not offer a private reporting route, contact the maintainer through their GitHub profile to arrange one before sharing technical details. Do not put credentials, customer data, or exploit details in a public issue.

Include affected versions, a minimal reproduction, impact, and any suggested mitigation. Use synthetic examples. Maintainers aim to acknowledge reports within three business days, communicate a triage decision within seven, and coordinate disclosure with the reporter. These are response goals, not a service-level guarantee.

## Trust boundaries

Specifications and Markdown are treated as untrusted input. Build plugins and future trusted MDX/React extensions execute code and require operator review and isolation. Capability declarations and timeouts do not sandbox JavaScript. Published artifacts are executable web content; stage them through trusted build pipelines and keep them immutable.

Private documentation authorization must protect HTML, route JSON, search indexes, source schemas, and assets. Host adapters preserve the application's security policy. API explorer credentials stay in memory and snippets use placeholders. A static publication requires an external authentication gateway to protect private material.

## Release requirements

Security-sensitive changes require meaningful authorization, XSS, SSRF, malformed-input and session tests where applicable. Release candidates require dependency/container scans, an updated threat model, and written triage of critical/high findings. The operator owns TLS, database credentials, secret storage, network policy, backups, and production monitoring.

Quality and release rehearsals require [CodeQL source analysis and severity checks](docs/code-security.md) for JavaScript/TypeScript and Java. [Container vulnerability acceptance](docs/container-security.md) separately assesses the actual runtime inventory. Automated checks complement the independent security review required for launch.

## Dependency audit policy

Dependencies are locked and the source pipeline runs `npm audit --audit-level=moderate`. The Markdown checker uses Node's built-in file globbing and the markdownlint library to avoid the vulnerable `braces` dependency in the former CLI wrapper. A root override pins KaTeX 0.18.2 for the Markdown linter's transitive dependency; remove it when upstream adopts a patched version. YAML parsing uses 2.9.1. A clean advisory audit is one signal and does not replace security review or container scanning.

All direct Zod dependencies use 4.6.6, the patched version for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), concerning memory exhaustion from oversized collections. Installed-package consumers repeat the advisory audit independently of the root workspace; prepared-version verification caught this finding when the root check passed. Keep input-size, collection and traversal limits in application code even when the validation library is patched.
