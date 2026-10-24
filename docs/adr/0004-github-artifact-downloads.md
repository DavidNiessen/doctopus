# ADR 0004: Authenticated registry metadata and credential-free artifact downloads

Status: accepted transport fix; complete replacement-candidate publication remains required.

Date: 2026-10-24.

## Context

The first protected GitHub publication uploaded the initial npm archive and Maven parent POM, then failed closed while reading them back. GitHub serves these artifact bytes through signed redirects. The original transport rejected every redirect, so mocks of direct registry responses did not establish native download compatibility.

[Read-only observation 40111682551](https://github.com/DavidNiessen/doctopus/actions/runs/40111682551) captured HTTP 302 responses from both authenticated endpoints without following them or printing signed URLs. The npm endpoint selected `https://pkg-npm.githubusercontent.com`; Maven selected `https://github-registry-files.githubusercontent.com`. Metadata remained at the configured registry.

## Decision

Allow a single redirect only for explicitly selected GitHub artifact GET requests. npm registry URLs may select only the exact npm CDN origin above; Maven URLs may select only the exact Maven CDN origin above. HTTPS, default port and absence of URL credentials/fragments are required. Malformed/oversized locations, another origin, another registry's CDN and any further redirect fail closed. Direct requests to these CDN origins remain outside the general release-origin allowlist.

The initial registry request retains its scoped authentication. The CDN request uses a new request configuration: no original headers, body, credential options or referrer; credentials are explicitly omitted. Only the signed URL authorizes the artifact download. Redirect targets and underlying transport errors are never printed because a signed URL is itself a capability. Both requests share one 120-second deadline, with the existing bounded response reader.

Metadata, publication writes, npmjs/Central and OCI requests retain redirect refusal. The npm manifest's tarball address must still use its selected registry. The explicitly permitted CDN transfer does not replace archive size, SHA-256, SHA-512 integrity, immutable-version checks or original producer-attestation verification. Maven still checks every accepted file's size/hash and its producer provenance. Fresh registry consumers remain mandatory.

Keep a read-only manual diagnostic workflow using the normal repository token with `packages: read`. Relevant diagnostic/transport pushes also run it. It reports status, CDN origin and content hashes, never Authorization headers, response bodies or signed redirect locations. These observations do not approve publication.

## Validation and consequences

- Regression tests verify that CDN requests drop all original headers and credential/referrer options, reject unapproved origins, writes and further hops, retain response bounds, and redact signed locations from fetch/stream errors.
- [Native corrected-download run 40112262485](https://github.com/DavidNiessen/doctopus/actions/runs/40112262485) at `3d9d53a` fetched the existing 75,704-byte npm archive and 5,130-byte Maven POM with the new transport. Their SHA-256 hashes match the original producer-verified candidate `.6`; npm integrity also matches. This is native partial-artifact download evidence, not acceptance of a complete distribution release.
- The `.6` publication is partial and cannot authorize an announcement. Existing versions and tags remain immutable. A replacement version must carry this transport change through full candidate checks and all required registry consumers.
- A future GitHub CDN change requires a reviewed exact-origin update and new acceptance evidence. Arbitrary redirects or credential forwarding are not fallback behavior.
