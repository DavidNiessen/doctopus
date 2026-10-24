# Container vulnerability acceptance

The server image's dependency inventory and its vulnerability assessment are separate required checks. Quality and prepared release rehearsal run both through the same composite action. A daily scheduled workflow also checks current npm advisories and rebuilds/scans the current server; it does not claim to repeat deployment acceptance. Findings and incomplete evidence are retained for fourteen days, including on failure.

## Run against a tested image

Use the pinned Node version from `.node-version`, a built checkout and the exact immutable image ID that passed [container acceptance](deployment.md#disposable-server-container-acceptance). Preserve the host's proxy and CA configuration. The scanners run on Linux x64; the application runtime is separate.

```sh
node scripts/install-inventory-tool.mjs
node scripts/container-inventory.mjs "$(cat /tmp/doctopus-server.id)" > .doctopus/container-inventory-evidence.json
node scripts/check-container-inventory.mjs "$(cat /tmp/doctopus-server.id)"
node scripts/install-security-tool.mjs
node scripts/container-security.mjs "$(cat /tmp/doctopus-server.id)" > .doctopus/container-security-evidence.json
node scripts/check-container-security.mjs "$(cat /tmp/doctopus-server.id)"
```

Grype 0.121.0 is pinned by its upstream archive and executable SHA-256 hashes. The common installer also retains the existing pinned Syft behavior: modified executables, symlinks and changed downloads fail before execution. No downloaded installation script runs. Downloads use verified HTTPS and inherited proxy/CA settings.

The assessment first requires a complete, checksum-verified inventory for the selected image and current workspace versions. It copies those exact bytes into its own scan input and hashes the snapshot before and after scanning. The scanner receives an explicit data-only configuration; inherited `GRYPE_` policy overrides are cleared for this child process. Proxy, certificate and runtime authentication context remain inherited. The SBOM scan does not pull images or access a registry.

## Required policy and evidence

The database must be valid, verified by hash, no older than 48 hours and obtained through the official HTTPS database endpoint with its checksum identity. The command requires an update check; a network/database failure does not become a passing assessment. Evidence with invalid or future timestamps is refused. The raw scan must have been recorded within the preceding 24 hours.

Critical, high and unknown-severity matches block acceptance, including findings with unavailable or declined fixes. Medium, low and negligible matches remain in the assessment and need normal security triage. The gate rejects excluded packages, fix-availability filters, VEX waivers and suppressed findings. Grype's built-in upstream-kernel-header rules can appear in configuration; any actually suppressed result is refused. No project waiver or blanket ignore list is provided.

Each unique `.doctopus/container-security-candidates/` directory retains `server.grype.json` and `report.json`. An interrupted or invalid assessment retains `.incomplete`; a complete but policy-failing assessment writes its findings and returns a nonzero exit. Receipts bind the tool/source/scanner, immutable server configuration ID, inventory checksum, raw finding checksum, database identity, timestamp and severity/fix-state counts. The checker recomputes the policy from raw findings and rejects stale, changed, incomplete or mismatched evidence. The source fields describe the checkout running the assessment; they do not establish build provenance. Candidate receipts remain unsigned and unapproved for publication.

The vulnerability database cache is under `.doctopus/tools/grype-db`; allow several GiB plus extraction space. Temporary scan input is removed after the command. Protect scanner configuration and cache paths from untrusted writers. Do not include database caches, credentials or live API responses in public artifacts. Air-gapped operators can perform this connected-host assessment before mirroring reviewed application images; offline startup does not establish a current advisory verdict.

The receipt checker opens the raw findings as a bounded regular file, checks its descriptor and computes the checksum and policy assessment from the same byte snapshot. It refuses symbolic links and special files on the supported Linux scanner host. See the [triage record](security-triage.md) for findings and subsequent dependency changes that need a fresh image assessment.

## Runtime remediation

The current Docker targets build with Node 24.22.1 and distribute a digest-pinned Alpine 3.24 runtime with the same Node version. npm, npx, Yarn and Corepack are removed from the runtime because source builds and dependency installation belong to the build stage. Runtime acceptance checks the absence of their executables in addition to the existing non-root, filesystem, resource and kernel controls. The isolated build image still includes the preinstalled application/compiler dependencies and executes approved offline builds; it does not install packages. Custom native dependencies must target Alpine/musl and be installed in a separately reviewed build stage/image.

The first Bookworm inventory scan found 273 matches, including eight critical and ninety high matches; global package-manager dependencies contributed findings beyond the application's clean npm audit. An intermediate Alpine image on Node 24.19 removed those package-manager matches but retained outdated OS packages. That result required a further runtime/toolchain update; it was not accepted as a clear scan.

The refreshed Node 24.22.1 image passed the local gate using the database built on 2026-10-23: zero critical, high or unknown-severity matches. Three medium matches remained for CVE-2025-60876 across BusyBox packages, with no fix version supplied by the scanner. These remain visible for triage; a passing threshold does not mean there are no vulnerabilities. All 44 local lifecycle, HTTPS, recovery, offline-installation and historical upgrade/rollback checks also passed. Subsequent [hosted .7 acceptance](release-acceptance.md) passed the full candidate and protected publication, including a fresh signed scan of the original image and anonymous consumer verification. That later scan retained zero Critical/High/Unknown and three Medium findings. Scanner matches require remediation or evidence-based investigation and do not by themselves prove application exploitability. Automated scans do not replace independent security, license or isolation review or stable production approval.
