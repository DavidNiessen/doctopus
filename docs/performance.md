# Performance verification

Performance numbers describe measured fixtures, not a universal service guarantee. Run `node --max-old-space-size=1536 scripts/benchmark.mjs 10000` after `npm run build`. The script builds real static pages, verifies output, checks 100 local search queries, records peak process RSS, and fails when its declared budgets are exceeded. Generated fixtures and reports stay under ignored `.doctopus` paths.

Candidate `.3` exposed a full-build budget failure: [run 40097708002](https://github.com/DavidNiessen/doctopus/actions/runs/40097708002) built 10,000 operations/50,000 schema nodes in **121.31 seconds**, over the unchanged 120-second ceiling. Peak RSS **949.5 MiB**, search p95 **9.78 ms** and incremental guide p95 **267.14 ms** passed their existing budgets. Source was clean at `4817011`, tool/publication version `0.2.0-candidate.3`; artifact digest was `2b477e6c653d7ba2d86fbf9baa839ad77291c1d7d4e92b92266a2d70229e86ff`. This candidate cannot authorize publication. Earlier passing runs below remain historical evidence.

After retaining the failure report, the superseded run's remaining queued demo job was cancelled. Its compiler job's failed verdict and measurements remain available; no registry publication occurred.

The optimization subsequently passed [full-size performance run 40098863195](https://github.com/DavidNiessen/doctopus/actions/runs/40098863195) at clean source `722942b` in **105.89 seconds**. After PR #13 merged with all 31 checks passing, [candidate `.4` run 40099824726](https://github.com/DavidNiessen/doctopus/actions/runs/40099824726) repeated the 10k fixture at clean source `46ded3f` in **74.89 seconds**, **932.7 MiB** RSS, **8.75 ms** search p95 and **229.74 ms** incremental-guide p95. Both reports identify version `0.2.0-candidate.4` and artifact digest `5fbd47dc44ab484697c17e67ad6d9bf9713b0c416ee3e396067d8eabc0db24b3`. Shared-runner timings vary; these are individual observations, not a controlled speedup ratio. The overall `.4` candidate still failed a separate WebKit Studio publication journey and cannot authorize publication.

The follow-up indexes bounded navigation selection once per immutable graph instead of rescanning every API operation for every page. It preserves source ordering, tag quotas, repeated active identities and route-specific content. Static output writes overlap in batches of four; every write settles before staging cleanup can run after a failure. Regression coverage compares direct/indexed projections across a 10k-operation graph and bounds full-graph reads during repeated projections.

A local 1,000-operation smoke run completes in **8.57 seconds**, **423.5 MiB** RSS, with identical full-build artifact digest `2198d67d7ed35e2b9fcdefb28abb4ca3bd86f2079d53d72d76c44acb25527c1c` before and after the optimization. Its modified source and reduced fixture do not satisfy the full-size release gate. The preceding 11.12-second observation had CPU profiling enabled and is not a controlled speed comparison. A fresh hosted 10k run and a new matching signed candidate remain required; no threshold or fixture size was relaxed.

## Prepared candidate acceptance

Release rehearsal repeats both compiler and reader budgets after applying the candidate version in a fresh checkout. Reports record the measured `toolVersion`, publication `artifactCompilerVersion`, source commit, dirty-tree status and artifact digest. The browser benchmark rejects a demo built by a different compiler version before measuring it. Rebuild the demo after version preparation; a benchmark from an older publication does not validate the candidate.

`node scripts/check-prepared-performance.mjs compiler` and `browser` enforce the full-size release evidence. Compiler acceptance requires 10,000 operations/50,000 schema nodes, 100 warm searches, 20 incremental updates and the existing time/memory ceilings. Reader acceptance requires ten cold samples on each guide/endpoint route with the existing mobile viewport, fourfold CPU slowdown, 150 ms latency and bandwidth profile, plus the existing LCP/CLS/interaction/JavaScript ceilings. Missing artifacts, mismatched versions/commits, reduced fixtures, weaker declared profiles/budgets and nonfinite measurements fail. Reader p95/max summaries must also agree with the retained raw samples. The browser checker requires one report directory in its fresh checkout to avoid silently selecting historical results.

The prepared source is intentionally dirty because metadata was advanced without creating a release commit. These receipts validate an unpublished rehearsal; repeat release acceptance against the reviewed final commit before publishing. Measurements and public fixture screenshots are retained for 28 days. Lab interaction timings remain distinct from field INP, and this gate does not establish sustained server throughput or production capacity.

## Prepared candidate hosted results

[Release rehearsal 39995916569](https://github.com/DavidNiessen/doctopus/actions/runs/39995916569) passed all jobs at source `36ee79b`, preparing unpublished version `0.2.0`. Both reports identify that tool/publication version, source commit and intentionally dirty prepared tree. The 10,000-operation/50,000-schema-node compiler fixture completed in **57.79 seconds**, with **944.5 MiB** peak RSS, **4.92 ms** warm search p95 and **161.03 ms** incremental guide p95. The verified full-build artifact is `24e5de26161b73d62abb1fb891f83a497577004dafbf70e03187c88797327b8b`.

Ten cold mobile samples per guide/endpoint route reported LCP p95 **876/868 ms**, maximum CLS **0**, search-dialog interaction p95 **57.6/67.6 ms**, and calculated initial JavaScript gzip **127,643 bytes**. Reader artifact `bc5a60499538c13656a893cb7e35edc9eade70eea9c09b17a94a139976000ffb` passed the source/version/profile/sample/summary checks. All existing budgets passed. These shared-runner lab results are not a controlled comparison or field INP, and the prepared working tree is not an approved signed distribution.

## Recorded baseline

A cloud Linux run on 22 October 2026 used Node 24.19.0 with four reported available CPUs, a 1536 MiB V8 old-space limit, and an OpenAPI 3.1 fixture with 10,000 operations and 50,000 schema nodes.

| Measurement                            | Observed  | Budget              |
| -------------------------------------- | --------- | ------------------- |
| Complete static build and verification | 91.80 s   | 120 s               |
| Peak process RSS                       | 750.6 MiB | 2048 MiB            |
| Warm search query p95, 100 samples     | 10.78 ms  | 100 ms              |
| Representative endpoint HTML           | 92.3 KiB  | Reported separately |

This baseline uses route-specific content and bounded navigation. Reader JavaScript was approximately 79 KiB gzip before the dedicated search worker was added. Vite reports current bundle sizes in every production build. Cold search index transfer, browser rendering, and server request latency are separate measurements and must not be inferred from a warm Node search benchmark.

## Validated compiler run

After adding structural OpenAPI and JSON Schema validation, the same 10,000-operation/50,000-schema-node scenario completed in **97.34 seconds**, with **754.9 MiB** peak RSS, **7.99 ms** warm search p95 (100 samples), and **96.6 KiB** representative endpoint HTML. It used the same Node version, available CPU count and V8 memory limit. These are separate observed runs rather than a controlled attribution of individual changes. All declared full-build, memory and search budgets passed.

## Implementation controls

Pages embed only their active guide/operation and reachable schemas. Navigation includes bounded groups and always includes the active endpoint; large sites offer search for the full corpus. Page transitions fetch the corresponding `page-data.json`. Search data is partitioned into 500-record shards, fetched with bounded concurrency on demand, and queried in a Web Worker. A synchronous fallback preserves search if workers are unavailable.

Static pages remain readable without JavaScript. Assets are served with revalidation rather than an unsafe immutable cache policy on stable filenames. Publication manifests verify every generated file before activation.

## Server delivery benchmark

The server now caches immutable manifest metadata with an LRU limit of 16 publications and 32 MiB of serialized metadata. The cache coalesces concurrent loads and verifies the manifest identity. Its limits describe metadata payloads; JavaScript object overhead consumes additional memory. Authorization, token/session revocation, project visibility and active publication pointers are checked against PostgreSQL on every request. A failed repository read does not serve cached private content.

A 22 October 2026 run used a non-root, read-only application container with an enforced 2-CPU quota and 2 GiB memory limit, PostgreSQL 17 on an internal Docker network, and the fixture's real prerendered guide HTML. The client ran outside the container on the same four-CPU cloud host. PostgreSQL and the load generator shared host resources; this is not an isolated two-CPU VM benchmark. The app image digest was `sha256:06c345cd98fd636ef5bfb1150e19657fdd310345ef99245693e3576564af8d82`.

| Authentication              | Requests | Target / observed rate  | Failures | p50     | p95     |
| --------------------------- | -------- | ----------------------- | -------- | ------- | ------- |
| Anonymous public reader     | 3000     | 100 / 100.03 per second | 0        | 2.42 ms | 3.40 ms |
| Scoped private viewer token | 3000     | 100 / 100.02 per second | 0        | 2.61 ms | 3.52 ms |

Each run warmed 20 requests, scheduled arrivals over 30 seconds, consumed full HTML bodies and enforced a five-second request timeout. Private access was checked to deny anonymous requests before the run; the viewer token was revoked and verified unusable afterward. Latency includes the response body. The p95 budget is 100 ms. API/OIDC management throughput, cold manifest loading, large artifacts, WAN/mobile performance and sustained production load are separate scenarios.

Reproduce against a controlled local deployment:

```sh
node scripts/benchmark-server.mjs http://127.0.0.1:8080/docs/your-public-project/
# For private documentation, supply a secret file containing a scoped viewer token.
BENCHMARK_TOKEN_FILE=/secure/viewer-token node scripts/benchmark-server.mjs http://127.0.0.1:8080/docs/your-private-project/
```

The script accepts only loopback HTTP targets without embedded credentials, query strings or fragments. It fails on response errors, p95 above 100 ms or achieved rate below 95 requests/second. Reports stay under ignored `.doctopus` paths. Set equivalent CPU/memory constraints and record the storage/database/network conditions when comparing runs. Do not use production API credentials for a load fixture.

## Remaining performance gates

The full-build, memory, warm search and tested server delivery budgets pass on the recorded fixtures. Incremental Markdown timing is recorded below. A controlled browser run is recorded below. Broader device/browser coverage, field interaction measurements and dependency-aware caching for trusted extension code still need evidence before a production release claim. Avoid extrapolating these results to different hardware, content sizes, plugin behavior, or private-network APIs.

## Incremental Markdown build evidence

A warm development-builder run on the same four-CPU Linux/Node 24.19.0 environment used 10,000 operations, 50,000 schema nodes and one authored guide. The full verified build took **92.45 seconds**. Twenty guide-body edits measured **202.08 ms p95**, passing the two-second target. The complete process, including the retained development graph and all updates, peaked at **941.5 MiB RSS**; warm search p95 was **13.17 ms** across 100 samples. Endpoint HTML was **97.8 KiB**. These are separate observed runs; earlier fixtures had no authored guide.

`dev` retains a verified graph and file hashes. A plain Markdown body edit with unchanged title, group, order, description and route updates its guide/root HTML and JSON, affected search shards, full compatibility data and the publication manifest. Files are replaced atomically and the manifest is written last. Tests compare the resulting artifact digest and every file digest against a clean full build, preserve unchanged API page timestamps, exercise parser errors, and reject output symlinks. A separately replaced output invalidates the cache.

Navigation/configuration/specification/asset changes and projects containing trusted MDX or plugins use a full rebuild. This conservative path avoids reusing code with undeclared dependencies. The cache belongs to a running preview process, assumes it owns its output, and is not shared between projects or authorization partitions. Publication staging continues to verify every file, including unchanged cached files. The incremental path does not replace the fully verified production build or make local preview edits a multi-file transactional publication.

## Controlled mobile browser evidence

Run `npm run build`, `npm run demo:build`, then `npm run benchmark:browser`. The script starts and closes its own loopback static server, verifies the publication manifest, and uses Playwright Chromium. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a system browser or install Playwright's browser. Reports and first-sample screenshots stay in ignored `.doctopus/browser-benchmark` directories. A scheduled/manual performance workflow runs browser and 10k compiler budgets in separate jobs and retains reports for 28 days; remote execution still requires working GitHub Actions account access.

A 22 October 2026 run used Chromium **154.0.8037.57**, Node **24.19.0**, four available CPUs on an AMD EPYC 9V74 cloud host, a **390×844** viewport at device scale 1, **4× CPU slowdown**, **150 ms latency**, **1.6 Mbit/s download** and **750 kbit/s upload**. Ten cold contexts per route had HTTP caches disabled and service workers blocked. Delivery used uncompressed loopback HTTP; initial gzip sizes below are calculated from downloaded JavaScript rather than observed compressed wire bytes. No mock API requests or external assets were needed.

| Fixture                | LCP median / p95 | Maximum CLS | Search-open latency p95 | Initial JS gzip |
| ---------------------- | ---------------- | ----------- | ----------------------- | --------------- |
| Quickstart guide       | 696 / 716 ms     | 0           | 101.7 ms                | 80.1 KiB        |
| List-projects endpoint | 732 / 752 ms     | 0           | 116.1 ms                | 80.1 KiB        |

Budgets passed: LCP p95 ≤2500 ms, CLS ≤0.1, scripted interaction p95 ≤200 ms, and initial guide JavaScript ≤150 KiB gzip. With ten samples, p95 is the maximum observed sample. LCP is observed before interaction; CLS uses the maximum session window excluding recent user input. Interaction measures the search click's capture handler to the second animation frame after opening its dialog. It is a controlled lab latency and **does not establish field INP**, network search latency, or every explorer interaction.

The measured artifact digest was `4b7c4e06fd2aba92af89f6f62b67525798dfbfc2176b37e99b06e257da64a6bb`. The run used an in-progress working tree and records that fact alongside the base commit and artifact digest; it is not a released artifact certification. Browser/CDP emulation, shared host resources, small fixture size, and a short sample window limit extrapolation to physical phones, large content, other browsers or production networks. The benchmark intentionally fails on missing paint data, hydration failure, browser errors, unexpected external requests, or exceeded budgets.

### Reader feature follow-up: 23 October 2026

A clean checkout at `6e2857f` repeated the same ten-cold-context mobile profile after the modal, response editor, richer body controls and credential-memory work. Chromium 154.0.8037.57, Node 24.19.0, the four-CPU host, viewport, throttling, disabled caches and uncompressed loopback delivery were unchanged. No external asset or API requests were needed.

| Fixture                | LCP median / p95 | Maximum CLS | Search-open latency p95 | Initial JS gzip |
| ---------------------- | ---------------- | ----------- | ----------------------- | --------------- |
| Quickstart guide       | 840 / 868 ms     | 0           | 107.3 ms                | 104.6 KiB       |
| List-projects endpoint | 820 / 856 ms     | 0           | 89.7 ms                 | 104.6 KiB       |

All existing LCP, CLS, interaction and guide-JavaScript budgets passed. The calculated initial JavaScript size was 107,122 gzip bytes from 349,979 downloaded bytes. Hydration samples were approximately 2.47–2.59 seconds under this uncompressed/throttled profile; the reported interaction starts after hydration. The lab measurement and small-fixture limitations above still apply, including the distinction from field INP.

The source was clean, and the verified artifact digest was `457b80d1188a4bc57340d81d0578652f450cff88afea76c820093e9e991830b3`. Retained evidence: `.doctopus/browser-benchmark/1792718640703/report.json`. This is local pre-release evidence, without hosted-CI or release certification.

### Hosted reader follow-up: 23 October 2026

Clean source `6f1e5ce` passed the same ten-cold-context mobile profile locally and in [hosted performance run 39984265218](https://github.com/DavidNiessen/doctopus/actions/runs/39984265218). Both builds produced artifact `da516e289852c400b47a6b6085f10265af96ffb75a017b40eeac5187e89858cf`. The local browser remained Chromium 154.0.8037.57; the hosted runner used pinned Chromium 156.0.8078.4. Each reported four available CPUs. These are separate lab runs, not a controlled comparison of browser versions or hardware.

| Run / fixture   | LCP median / p95 | Maximum CLS | Search-open p95 | Initial JS gzip |
| --------------- | ---------------- | ----------- | --------------- | --------------- |
| Local guide     | 972 / 1000 ms    | 0           | 98.6 ms         | 124.7 KiB       |
| Local endpoint  | 964 / 1068 ms    | 0           | 125.0 ms        | 124.7 KiB       |
| Hosted guide    | 808 / 832 ms     | 0           | 38.7 ms         | 124.7 KiB       |
| Hosted endpoint | 792 / 816 ms     | 0           | 39.8 ms         | 124.7 KiB       |

The existing browser budgets pass, including the 150 KiB initial-guide JavaScript ceiling. The increased catalog and reader controls have grown calculated initial gzip JavaScript to 127,643 bytes; the lab/field and uncompressed-transfer limitations above remain applicable. Hosted reports/screenshots are retained for 28 days; local evidence is `.doctopus/browser-benchmark/1792771701003/report.json`.

The same hosted run's **compiler budget failed**: 10,000 operations/50,000 schema nodes took **130.45 seconds**, above 120 seconds. Peak RSS (951.3 MiB), warm search p95 (10.51 ms) and incremental guide p95 (237.03 ms) passed their existing ceilings. This result supersedes any assumption that the older compiler timings establish current hosted performance. The budget is unchanged. Profiling identified repeated full endpoint scans during route projection; the compiler now builds an endpoint lookup once for its immutable render graph. `createPageDataFactory(site)` supplies this indexed projection; create a new factory after graph changes. The ordinary `createPageData` API retains its direct endpoint lookup. A 1,000-endpoint local comparison improved 8.72 to 8.02 seconds with the same artifact digest; the hosted follow-up below verifies the full-scale gate.

### Indexed-route full-scale acceptance

[Hosted performance run 39986990272](https://github.com/DavidNiessen/doctopus/actions/runs/39986990272) passes both compiler and reader jobs at clean source `97f08a4`. The same 10,000-operation/50,000-schema-node fixture completed its full verified build in **54.37 seconds**, with **929.0 MiB** peak RSS, **5.78 ms** warm search p95 and **158.92 ms** incremental guide p95. Node remained 24.19.0 and four CPUs were available. Endpoint HTML was 101.4 KiB; the full-build artifact digest was `d0908280f74df6ea45294549dbf0daa53a1eb3a75966a0867e921633ef0d7fa5`.

All unchanged compiler budgets pass: 120 seconds full build, 2048 MiB peak RSS, 100 ms warm search and 2000 ms incremental guide updates. This resolves the recorded hosted compiler gate failure. These are observed runs on shared cloud hardware, without controlled attribution of every timing difference. The index removes repeated full-list route selection; complete page-data/HTML parity, browser acceptance and installed-package checks separately cover behavior. Raw artifact identity also includes generated client source maps, which change when their source changes.

## Artifact verification regression check

After introducing strict shared manifest validation and bounded/streaming file hashing, a separate run used the 10,000-operation/50,000-schema-node fixture with one guide on Node 24.19.0, four available CPUs and a 1536 MiB old-space limit. The full verified build took **108.54 seconds**, peak process RSS was **852.2 MiB**, warm search p95 was **8.63 ms** (100 queries), and incremental guide p95 was **208.9 ms** (20 edits). Endpoint HTML was **97.9 KiB**. All existing budgets passed. These are observed runs, not a controlled attribution of individual changes.

The report now records the base commit, whether tracked/untracked source changes were present, and the full build's artifact digest. This in-progress run used base `6088189` with a dirty working tree and full-build artifact `0a867b1b751ab845989f8e7be049a9c9e090f653fc4e255837a8ea61341ab43d`; subsequent incremental edits intentionally replace that preview artifact. Metadata is validated before use. Small files use at most a 1 MiB buffer plus a growth sentinel; larger payloads are hashed in 64 KiB chunks. Both paths reject special files and detected size changes.
