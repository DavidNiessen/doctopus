# Changelog

<!-- markdownlint-configure-file {"MD024": {"siblings_only": true}} -->

## 0.2.0-candidate.7 - 2026-10-24

Support GitHub's signed artifact downloads through one exact CDN hop without forwarding registry credentials, headers or referrers. Metadata and writes retain redirect refusal; original-byte integrity and producer checks remain required. Native read-only downloads match the partial `.6` artifacts, whose published versions and tag remain immutable. This replacement passed all 22 signed candidate jobs and all nine protected publication/fresh-consumer jobs and is now a [published prerelease](docs/release-acceptance.md). Independent launch reviews remain deferred for prereleases.

### Fixes

- **release:** verify GitHub CDN downloads without forwarding credentials ([3d9d53a](https://github.com/DavidNiessen/doctopus/commit/3d9d53acfe8d7a7e552df35fdbb0e0c0f75e2981))

### Documentation

- **release:** record native registry downloads and partial publication ([5ec38f6](https://github.com/DavidNiessen/doctopus/commit/5ec38f61bf4d4c36c41b93d0ad66caeee7c6be7e))

[Full changelog](https://github.com/DavidNiessen/doctopus/compare/v0.2.0-candidate.6...v0.2.0-candidate.7)

## 0.2.0-candidate.6 - 2026-10-24

Verify repository protection with an administrator-read source snapshot bound to GitHub's live ruleset revisions. This supports read-only workflow tokens without treating hidden bypass actors as an empty list. Drift, visible bypass mismatches and malformed evidence remain blocking. No new secret or elevated workflow permission is required; native approval, signatures, security and fresh registry installation remain required. Independent launch reviews remain deferred for prereleases.

### Fixes

- **release:** bind protection snapshots to live ruleset revisions ([6b466c7](https://github.com/DavidNiessen/doctopus/commit/6b466c778869a80101c378ef11e701bda0049639))

[Full changelog](https://github.com/DavidNiessen/doctopus/compare/v0.2.0-candidate.5...v0.2.0-candidate.6)

## 0.2.0-candidate.5 - 2026-10-24

Studio waits for the current view's publication history before enabling artifact entry and activation, and offers an explicit retry after an initial load failure. The delayed-load browser journey verifies failure recovery and real publication. Earlier candidates remain immutable; this version requires its own full browser matrix, signed acceptance and registry checks. Independent launch reviews and pilots remain deferred for prereleases.

### Fixes

- **studio:** gate publication controls on loaded history ([3fd075b](https://github.com/DavidNiessen/doctopus/commit/3fd075bd6506ad7d019fb62c8c92b648197644ef))

[Full changelog](https://github.com/DavidNiessen/doctopus/compare/v0.2.0-candidate.4...v0.2.0-candidate.5)

## 0.2.0-candidate.4 - 2026-10-24

Reduce large-site build work by indexing bounded navigation once per graph and overlapping static writes in bounded batches. The 120-second/10,000-operation release budget remains unchanged. Candidate `.3` failed that budget and was superseded; this version requires fresh full-size acceptance before publication. Independent launch reviews and pilots remain deferred for prereleases under the owner's recorded decision.

### Performance

- **compiler:** index navigation and overlap bounded page writes ([2177eea](https://github.com/DavidNiessen/doctopus/commit/2177eea212552d9f02fa327fcf5750352a1b15a1))

[Full changelog](https://github.com/DavidNiessen/doctopus/compare/v0.2.0-candidate.3...v0.2.0-candidate.4)

## 0.2.0-candidate.3 - 2026-10-24

The owner deferred independent security, isolation, accessibility, license reviews and external pilots for this prerelease. Their status remains unfinished and visible in publication plans. Automated acceptance, signatures, protected publishing and fresh registry installation checks remain required; stable publication still requires review approval.

### Features

- **release:** allow explicit owner-deferred prerelease reviews ([9b0d1ea](https://github.com/DavidNiessen/doctopus/commit/9b0d1eaf77e00e545c728db0dbed81f7c7ecbdd8))

[Full changelog](https://github.com/DavidNiessen/doctopus/compare/v0.2.0-candidate.2...v0.2.0-candidate.3)

## 0.2.0-candidate.2 - 2026-10-24

### Package coordinates

- npm packages now use `@davidniessen/*`; update imports and workspace dependencies from `@doctopus/*`. Maven coordinates retain `dev.niessen`. GitHub destinations bind to the source repository owner; actual registry publication remains pending.
- Distributions target GitHub Packages for npm/Maven and GHCR for containers. Protected publishers use repository Actions tokens; npm/Central accounts and a production OpenPGP key are unnecessary. Public npm/Maven installation requires GitHub authentication; see [installation instructions](docs/github-packages.md).
- Fresh consumers verify downloaded bytes against original producer attestations, package visibility, installed framework behavior and offline compilation. Actual protected registry publication and independent launch reviews remain pending.

### Fixes

- **release:** keep validation portable and record signed candidate acceptance ([9efa4f6](https://github.com/DavidNiessen/doctopus/commit/9efa4f61e492eb45156dbbdce8a75f6e61379ee4))
- **release:** require current approving reviews before publication ([6e9a5f7](https://github.com/DavidNiessen/doctopus/commit/6e9a5f7c3515a534f4b48e7bab8c80b7cc23585d))

[Full changelog](https://github.com/DavidNiessen/doctopus/compare/v0.2.0-candidate.1...v0.2.0-candidate.2)

## 0.2.0-candidate.1 - 2026-10-24

### Features

- **core:** implement typed OpenAPI compiler and extension contracts ([35bbe9d](https://github.com/DavidNiessen/doctopus/commit/35bbe9d10a95a59b5e5452808dd832ae66b91007))
- **reader:** ship static docs renderer and interactive API playground ([3b173cd](https://github.com/DavidNiessen/doctopus/commit/3b173cd29b6d0b851cc7c2fe5535bff53fd4c63e))
- **server:** add authenticated publication control and audit storage ([ae1c9cb](https://github.com/DavidNiessen/doctopus/commit/ae1c9cb8118d3d38fa56ba326c095cccacd1a310))
- **integrations:** add Java and Node adapters with publication studio ([3591dae](https://github.com/DavidNiessen/doctopus/commit/3591dae5be7ecd649450aebbb4988a532c23ebad))
- **deploy:** add hardened containers and verified backup recovery ([a5591bf](https://github.com/DavidNiessen/doctopus/commit/a5591bf63aeaa790f11e933dd4715664e9d4f88a))
- **spec:** validate OpenAPI contracts and document incoming events ([83d455c](https://github.com/DavidNiessen/doctopus/commit/83d455c1cc1552448930c3cd426e9dce8f965706))
- **content:** add trusted MDX and accessible guide components ([b617850](https://github.com/DavidNiessen/doctopus/commit/b6178501d943b8cbbcf3f3cc3230152c598b0fd7))
- **branding:** add validated themes, local assets and search metadata ([901dadd](https://github.com/DavidNiessen/doctopus/commit/901dadd7c9bb48ee5261a4c95c5e7bb548171075))
- **theme:** add accessible live appearance preview ([e97b6b3](https://github.com/DavidNiessen/doctopus/commit/e97b6b398324cc588fefe2ea933ea3ed165871d0))
- **spec:** classify directional API contract compatibility ([073dc57](https://github.com/DavidNiessen/doctopus/commit/073dc57f7d3f1658c7c3c6bddc25a68b88abece2))
- **plugins:** bound trusted execution and add conformance tooling ([8caf8fe](https://github.com/DavidNiessen/doctopus/commit/8caf8fe226be7370fac77a72298a2abcf08b2a0d))
- **doctor:** validate authored examples offline in bounded workers ([6518701](https://github.com/DavidNiessen/doctopus/commit/6518701fa06b2c24e58993239e501ad560c858a7))
- **doctor:** verify publication links and configurable coverage rules ([6088189](https://github.com/DavidNiessen/doctopus/commit/60881894c55fb9a12c5252c79f056d9a642947f1))
- **reader:** select authored examples and response media types ([e2ba376](https://github.com/DavidNiessen/doctopus/commit/e2ba376e19360a2b67ce1dbaa61eed90111cd346))
- **release:** verify packed npm consumers and collect browser notices ([b276870](https://github.com/DavidNiessen/doctopus/commit/b276870f96f28238bca9bb8fa3c4cb5679a2dea8))
- **explorer:** add bounded public-client PKCE protocol helpers ([dfcd5f0](https://github.com/DavidNiessen/doctopus/commit/dfcd5f033e6656adf3b50af9c61ece6d1f0df90d))
- **reader:** authorize API requests through a static PKCE callback ([4e4e0ee](https://github.com/DavidNiessen/doctopus/commit/4e4e0eecfae930cc549ef1f73a6f03fefc77baf4))
- **explorer:** serialize structured and content-based parameters safely ([98c9d8e](https://github.com/DavidNiessen/doctopus/commit/98c9d8e3bf66d7fe69004ada49a0f147911470bf))
- **reader:** edit JSON fields without losing precision or exposing secrets ([7365183](https://github.com/DavidNiessen/doctopus/commit/73651835968e758649ffd39383775cdd8f4082a6))
- **explorer:** encode logical form bodies with content and style codecs ([de7e39e](https://github.com/DavidNiessen/doctopus/commit/de7e39e1dda60d9a16329fed638a87e463f68347))
- **reader:** edit form values and literal encoded request bodies ([8330ba1](https://github.com/DavidNiessen/doctopus/commit/8330ba18eb5752d9dea50039748761250261a7c3))
- **artifacts:** verify portable manifest identities across Java and Node ([82af312](https://github.com/DavidNiessen/doctopus/commit/82af312abaacafd7c03241690908c0099be2868f))
- **lifecycle:** inventory API retirements and enforce migration policies ([4890941](https://github.com/DavidNiessen/doctopus/commit/4890941173fb386986d71d9209da725d00bc9ae8))
- **reader:** publish a paginated deprecation center and migration notices ([b1bbdd8](https://github.com/DavidNiessen/doctopus/commit/b1bbdd820702ff163cbbfce4ef0d1d5182a98afe))
- **explorer:** prepare bounded binary-safe multipart uploads ([fb94ab5](https://github.com/DavidNiessen/doctopus/commit/fb94ab5d6d474bef418747667ddcd6b4db0d67d4))
- **snippets:** generate binary-safe multipart clients in five languages ([de69ed6](https://github.com/DavidNiessen/doctopus/commit/de69ed62a0934d50757d16d6730217f1497864ee))
- **reader:** upload multipart files with schema-aware safe previews ([19ffc2e](https://github.com/DavidNiessen/doctopus/commit/19ffc2e4e5e617604e9c233d47ed4b851cbacfae))
- **release:** centralize runtime versions and audit distribution metadata ([6aec759](https://github.com/DavidNiessen/doctopus/commit/6aec7595056e05183d059c5e96d52a47c8f9397d))
- **reader:** open the API playground in a modal ([4887037](https://github.com/DavidNiessen/doctopus/commit/48870372b4a4a45d8486a772fa322bde080f3ed6))
- **release:** propose semantic versions and conventional changelogs ([bf62683](https://github.com/DavidNiessen/doctopus/commit/bf62683133d1bacbfad245d2f4e26be058abdd8b))
- **reader:** add response-only Monaco viewer and Unified URL bar ([e082e5c](https://github.com/DavidNiessen/doctopus/commit/e082e5c52647b8a5352d7688987fca496414355d))
- **release:** prepare reviewed version and changelog changes ([8608769](https://github.com/DavidNiessen/doctopus/commit/8608769c013bf25757da4f466533d7e8cd022e88))
- **reader:** add bounded nested request body fields ([0e8c29d](https://github.com/DavidNiessen/doctopus/commit/0e8c29d3916b1fe4b49602c132830f4c8d5078d8))
- **reader:** add bounded array request body controls ([85f6a34](https://github.com/DavidNiessen/doctopus/commit/85f6a34033ee7fce1f060ad19bff9bce8138e014))
- **reader:** support root array request body fields ([65fe679](https://github.com/DavidNiessen/doctopus/commit/65fe679e31f1a052a2b782b69766bc249e17908e))
- **java:** verify installed JAR consumers and package licenses ([1db4ed0](https://github.com/DavidNiessen/doctopus/commit/1db4ed0c1aa4da57f5ba8e1140c970704958826e))
- **java:** ship sources, Javadocs and bound dependency SBOMs ([f75e9ef](https://github.com/DavidNiessen/doctopus/commit/f75e9ef8af38cfa56524426c48a0004ae9fc2262))
- **spring:** support verified documentation at application root ([8d6f442](https://github.com/DavidNiessen/doctopus/commit/8d6f4428837155b4bc69c1b7ce18e586ed4b6582))
- **reader:** edit compatible allOf object request fields ([8ad80e4](https://github.com/DavidNiessen/doctopus/commit/8ad80e4a5c3ccb56c516fe04006ce7c7cd440e52))
- **cli:** verify and reload static publications ([3620f38](https://github.com/DavidNiessen/doctopus/commit/3620f38f207c779ccd78fb7187cf9faad3ed70ad))
- **spec:** import bounded verified remote OpenAPI snapshots ([613bfde](https://github.com/DavidNiessen/doctopus/commit/613bfde7eaa18cfb8f5d9d0dd8079f9b77c82532))
- **reader:** reuse credentials within approved API scopes ([6e2857f](https://github.com/DavidNiessen/doctopus/commit/6e2857f7eb6d22c39f54e28a9f09b8d75b6d2c1a))
- **plugins:** support typed theme token hooks ([0664caa](https://github.com/DavidNiessen/doctopus/commit/0664caa54dc26c9682074d0ef0fda65b85f0cee0))
- **plugins:** preprocess bounded spec sources before validation ([ed35a1d](https://github.com/DavidNiessen/doctopus/commit/ed35a1dabe9d3660f7e3260f9fd0fd3e8845522e))
- **plugins:** generate bounded build-time code examples ([6161471](https://github.com/DavidNiessen/doctopus/commit/61614711d460deff98353b6428fba64027d0e92d))
- **explorer:** serialize compatible composed form schemas ([3259dc3](https://github.com/DavidNiessen/doctopus/commit/3259dc39ea8e83b747517524fbb94f44c87f8aac))
- **explorer:** support bounded custom multipart part headers ([8f46a17](https://github.com/DavidNiessen/doctopus/commit/8f46a172dc7fc931a65d643bfcc6ac763561a950))
- **cli:** run offline builds in restricted Docker containers ([1f27222](https://github.com/DavidNiessen/doctopus/commit/1f272228cb21b4434eb1885365d45f7f9e406119))
- **explorer:** serialize multipart styles by OpenAPI dialect ([e77f0ef](https://github.com/DavidNiessen/doctopus/commit/e77f0ef4d98b0f6a14f97cca2930bad2bbcc19c8))
- **reader:** add optional canonical page feedback links ([94477a2](https://github.com/DavidNiessen/doctopus/commit/94477a2f2cf845d17d19be309ec76814a25048ab))
- **explorer:** preview deterministic local mock responses ([9bc2963](https://github.com/DavidNiessen/doctopus/commit/9bc29636cc4d52ae99a7802b156b710a2407423c))
- **spec:** expose bounded outbound HTTP transport ([9a78d99](https://github.com/DavidNiessen/doctopus/commit/9a78d99eef63e48c876de85d8a09b527b22bfa76))
- **server:** add opt-in authenticated API relay ([9651261](https://github.com/DavidNiessen/doctopus/commit/96512612e7e9f4793c53dbb38326e14478de4bb3))
- **reader:** add explicit authenticated relay transport ([779936a](https://github.com/DavidNiessen/doctopus/commit/779936acbe50938533fe6e4cedf923bfe87f8743))
- **reader:** add typed core UI translations ([91173af](https://github.com/DavidNiessen/doctopus/commit/91173af1375355eaf7520a792ba1c4ee3a62bf12))
- **reader:** add locale routes and content fallback ([ac2b6cd](https://github.com/DavidNiessen/doctopus/commit/ac2b6cd6d7dc29aa290a9c4dbee900df5e8ec8a2))
- **content:** support authored guide translations ([df842f2](https://github.com/DavidNiessen/doctopus/commit/df842f21592dd22ab39c55ab3f2072d2d929e5e0))
- **reader:** support reviewed browser extensions ([9d0d0f3](https://github.com/DavidNiessen/doctopus/commit/9d0d0f36c2d1913afd9885a40c342266af26b162))
- **spec:** vendor pinned external reference snapshots ([c9bf3b1](https://github.com/DavidNiessen/doctopus/commit/c9bf3b1ce683dabd8ac876edc03627ca9074b465))
- **ui:** add resizable islands and fullscreen responses ([e50f3f2](https://github.com/DavidNiessen/doctopus/commit/e50f3f2e273de8c053b95ee6d7204b3aeb5477bb))
- **reader:** add explicit request schema branch controls ([26ce4fb](https://github.com/DavidNiessen/doctopus/commit/26ce4fb9c914d0aa1596e91b6ae8008bd1b34959))
- **reader:** support bounded nested schema choices ([48318c4](https://github.com/DavidNiessen/doctopus/commit/48318c4d383a740304ca3a97583ac12a9c3ec777))
- **reader:** add personal themes layouts and sidebar filters ([03b420b](https://github.com/DavidNiessen/doctopus/commit/03b420b4ef44bdb23724889c7fa0b610b6910706))
- **explorer:** control parameter presence and empty values ([51b6670](https://github.com/DavidNiessen/doctopus/commit/51b6670cd54d04f225338ca106746702959d9b60))
- **reader:** show collapsed endpoint lists in classic layout ([8531ea0](https://github.com/DavidNiessen/doctopus/commit/8531ea02245138db6e57ea274b45ec5ad4260a75))
- **reader:** localize settings and classic reference controls ([758ea67](https://github.com/DavidNiessen/doctopus/commit/758ea677d119e3009a114fcb9a0ebcfeea3bd91f))
- **reader:** translate schema and lifecycle guidance ([4cef384](https://github.com/DavidNiessen/doctopus/commit/4cef3843ea91dd1c5bf53b298c9d13411a54cfb4))
- **cli:** pin isolated builds to approved source snapshots ([ff2c87f](https://github.com/DavidNiessen/doctopus/commit/ff2c87f874357792fb9ac575f8002e9e88d0f94e))
- **storage:** add durable leased build queues and schema upgrades ([cd5f99c](https://github.com/DavidNiessen/doctopus/commit/cd5f99c091a8d1038eb51a7d035f9eeefa64f89e))
- **server:** expose authorized build job and source APIs ([eae351c](https://github.com/DavidNiessen/doctopus/commit/eae351c8cc99723d2b73be28d64a1168351a1cbb))
- **reader:** simplify themes and match response editor colors ([b4d61f5](https://github.com/DavidNiessen/doctopus/commit/b4d61f5d7714dd0a3cdd4cc14922e76e46367395))
- **demo:** add mock-only GitHub Pages deployment ([144597f](https://github.com/DavidNiessen/doctopus/commit/144597fcbfbe911607c545ad1c2c515f88134b02))
- **worker:** execute approved queued builds in isolated Docker ([b7708b9](https://github.com/DavidNiessen/doctopus/commit/b7708b90a993c6bbc4362e05ff11ec20eef448bf))
- **studio:** manage approved sources and queued builds ([d71738a](https://github.com/DavidNiessen/doctopus/commit/d71738a3bf5d1d69f03e2fc45cd13ddb985e8af7))
- **studio:** tailor workspace actions to current project roles ([884bb33](https://github.com/DavidNiessen/doctopus/commit/884bb335d14e4d678ea82d7319c1c2db19dad6a6))
- **reader:** localize endpoint reference and parameter controls ([0bfa5c8](https://github.com/DavidNiessen/doctopus/commit/0bfa5c8b5b583a9b84772a0109e9543b5d9afc4f))
- **reader:** localize authentication and relay feedback ([f3c34b4](https://github.com/DavidNiessen/doctopus/commit/f3c34b48aa763e1401a4509ffede3704855a000d))
- **deploy:** support offline image mirrors and recovery overrides ([d9f991b](https://github.com/DavidNiessen/doctopus/commit/d9f991b115086a4dfcb115dfe95b96e4b86edca4))
- **release:** verify candidates and preview publication plans ([7e0feff](https://github.com/DavidNiessen/doctopus/commit/7e0feff2e36a47a7f505d342c79b7c2931e7f4e8))
- **release:** publish verified npm archives and check public consumers ([2ddcfbb](https://github.com/DavidNiessen/doctopus/commit/2ddcfbb2034eee9a1bddeab7a827b88dacc3ea05))
- **release:** sign Maven candidates and verify public Java consumers ([85cddcb](https://github.com/DavidNiessen/doctopus/commit/85cddcb1f2c41b41f8aaff4ff5559972422849d8))
- **release:** promote tested containers and verify anonymous consumers ([e3ca622](https://github.com/DavidNiessen/doctopus/commit/e3ca62274059955208e5268f5d3eccfd60765cc7))

### Fixes

- **release:** accept bounded missing-file registry responses and verify public container version tags against the tested digest.
- **publishing:** address artifacts by generated content and provenance ([ef72b17](https://github.com/DavidNiessen/doctopus/commit/ef72b17a74f33d6c4501e9aa64da09bcff776e4c))
- **security:** remove vulnerable tooling and gate dependency audits ([dadab1b](https://github.com/DavidNiessen/doctopus/commit/dadab1b1a7709fa5bb354ee7c92f044a705177ff))
- **security:** validate manifests and bound artifact file reads ([85b50b5](https://github.com/DavidNiessen/doctopus/commit/85b50b541b5691afb975076867e5f6af1867a5f7))
- **explorer:** verify executable snippets across five runtimes ([aacc530](https://github.com/DavidNiessen/doctopus/commit/aacc5307c2206eb6ae560761a9f5bee704dc2131))
- **spec:** reject non-JSON YAML values and bound alias expansion ([82ff2f3](https://github.com/DavidNiessen/doctopus/commit/82ff2f3dc24aa63915fd8e9dc14da9d3e27a7625))
- **reader:** render boolean schemas and composition constraints accurately ([9f3635d](https://github.com/DavidNiessen/doctopus/commit/9f3635da48ffab1c15bdede14601908384295a64))
- **doctor:** distinguish serialized examples from logical JSON values ([2aab314](https://github.com/DavidNiessen/doctopus/commit/2aab314d0fc7be8ca759eb5f8f97e8d90de91698))
- **spec:** preserve dialect and schema context in contract reviews ([33900dc](https://github.com/DavidNiessen/doctopus/commit/33900dcbc8f68551d338f5ef74b5390566367e92))
- **diff:** preserve security names and ignore descriptive scope text ([104b8b4](https://github.com/DavidNiessen/doctopus/commit/104b8b4e7439a9b29d10533ec0dc9c3a7fc05854))
- **release:** preserve saved plan round-trip identity ([5b12fc3](https://github.com/DavidNiessen/doctopus/commit/5b12fc33cb47fdbe29892a58f98f13fcce7a7187))
- **release:** retain repository JSON formatting during preparation ([6f21ce4](https://github.com/DavidNiessen/doctopus/commit/6f21ce476a4610fc249cd4d4d86ee42b4a1cd3d7))
- **reader:** conceal sensitive enum and constant labels ([31978cc](https://github.com/DavidNiessen/doctopus/commit/31978ccae4831c79f32bef101b13f7c28abe2ffc))
- **spring:** select the context prefix for the active web stack ([e6fb837](https://github.com/DavidNiessen/doctopus/commit/e6fb837c6da28138f2281cbda99f4ed5c22cd597))
- **node:** serve only verified publication files ([888c2c0](https://github.com/DavidNiessen/doctopus/commit/888c2c054e9d69be8d1b02e714675c2cabe80718))
- **release:** preserve canonical pnpm lockfile formatting ([7ff137a](https://github.com/DavidNiessen/doctopus/commit/7ff137a87a29bfc657e62b49ac855f8245e41896))
- **server:** drain requests and bound process shutdown ([628549b](https://github.com/DavidNiessen/doctopus/commit/628549b809630275963700ca772fa5cbbd54df67))
- **storage:** bound metadata queries and discard failed transactions ([0402f4b](https://github.com/DavidNiessen/doctopus/commit/0402f4b3eb9a8cc2852e2801fa376813028817ed))
- **plugins:** validate exported endpoint catalog metadata ([74afd5a](https://github.com/DavidNiessen/doctopus/commit/74afd5af7e61d2ae1b773462001ee85448478944))
- **worker:** reclaim expired workspaces after process death ([90552ea](https://github.com/DavidNiessen/doctopus/commit/90552ea76d0b57b741c95a6147166ea54bd46941))
- **studio:** fence requests across navigation and session changes ([78bc95f](https://github.com/DavidNiessen/doctopus/commit/78bc95f72504c20cdbb8767a4337d32002050a12))
- **spec:** reject unsupported schema scope semantics ([7a5b651](https://github.com/DavidNiessen/doctopus/commit/7a5b651484cbb9da633dd7019803c6f964915c85))
- **server:** return 503 during database outages ([3418f4f](https://github.com/DavidNiessen/doctopus/commit/3418f4f4942d4c7b5ece91359935f484c4443523))
- **release:** reject incomplete container inventories ([28b43aa](https://github.com/DavidNiessen/doctopus/commit/28b43aa79670b800d892cee6d52c289a265d87ee))
- **reader:** contain translated settings across browsers ([09ab319](https://github.com/DavidNiessen/doctopus/commit/09ab3197877cb6def98b9f83a8eef0ffe19f41f0))
- **ci:** match Firefox container user to the browser home ([cd5bec6](https://github.com/DavidNiessen/doctopus/commit/cd5bec6c1380368cae93528a7fbc8a2945fdc968))
- **ci:** fetch historical source in the upgrade build job ([368fff3](https://github.com/DavidNiessen/doctopus/commit/368fff3f09abe3e6e76b84094fe87d9ad67a7db8))
- **security:** refresh Node runtime and gate container vulnerabilities ([0cb2181](https://github.com/DavidNiessen/doctopus/commit/0cb2181956b05bcacb1b3f37ff90dd85bf013445))
- **security:** resolve CodeQL query-pack rule references ([f303cc3](https://github.com/DavidNiessen/doctopus/commit/f303cc3585ebabaceaf396f5ba8001dc1e176968))
- **deps:** update Zod to address collection memory exhaustion ([d8955b7](https://github.com/DavidNiessen/doctopus/commit/d8955b7b9b00777b7449140e88e755f6b94418ef))
- **security:** harden explorer parsing and evidence reads ([65a2c33](https://github.com/DavidNiessen/doctopus/commit/65a2c335cc7df64372ba9562e763b7878699ef1a))
- **security:** sanitize reader data and confine source paths ([93e7ade](https://github.com/DavidNiessen/doctopus/commit/93e7ade9d4208ed5df4a7b5774152ce1276cfdc8))
- **security:** bound adapter requests and confine source lookups ([2912184](https://github.com/DavidNiessen/doctopus/commit/291218466a0a1251210d443c6a56ec0f1c7a51de))
- **security:** validate canonical lookup prefixes before access ([7b40f45](https://github.com/DavidNiessen/doctopus/commit/7b40f45428ad523d4ad50d07a9508aa1f259eafa))
- **security:** align parser patches and bind image selection to receipts ([4042c8f](https://github.com/DavidNiessen/doctopus/commit/4042c8f0bafde5951b6ac704401611483f726b0c))
- **release:** handle early subprocess input closure safely ([bb02e9d](https://github.com/DavidNiessen/doctopus/commit/bb02e9dc2e44b5ee032e2ba8dc5216d51531295d))

### Performance

- **reader:** split page payloads and move sharded search off the UI thread ([61812a2](https://github.com/DavidNiessen/doctopus/commit/61812a23e746d80eba58e11e64c8c799bc2acb56))
- **server:** cache immutable manifests and verify reader load budgets ([35b7ea6](https://github.com/DavidNiessen/doctopus/commit/35b7ea6d731fe7b72227268c2d0485994c880d7b))
- **cli:** rebuild guide bodies incrementally with verified output parity ([93ea384](https://github.com/DavidNiessen/doctopus/commit/93ea384bdfa025d079a1a952216958c129b48fad))
- **reader:** enforce measured mobile browser budgets ([6e7ddd6](https://github.com/DavidNiessen/doctopus/commit/6e7ddd6433e1fc7aca75addb6d700a3b0fc7c78f))
- **compiler:** reuse endpoint lookup across generated pages ([97f08a4](https://github.com/DavidNiessen/doctopus/commit/97f08a4e1a4ff6869205afdde8ebaa0e30b95d71))

### Documentation

- **product:** define vision and launch requirements ([84a04b7](https://github.com/DavidNiessen/doctopus/commit/84a04b79d5b2a63cda014f468451dd300ffca452))
- **architecture:** specify extensible platform and plugin contracts ([d313943](https://github.com/DavidNiessen/doctopus/commit/d313943a5329debe568d1ae114a649d1629dca0a))
- **roadmap:** define delivery gates and open source launch ([40c06a5](https://github.com/DavidNiessen/doctopus/commit/40c06a52a7476a657a93b13e0de58ff5511d19cd))
- **community:** establish Apache licensing and open source policies ([46c2449](https://github.com/DavidNiessen/doctopus/commit/46c24495fb3e4c2ab4e63acd0527360286ecb633))
- **java:** record prepared-version consumer rehearsal ([67abb44](https://github.com/DavidNiessen/doctopus/commit/67abb44d4f99d6b1ff948a4b28b053beaf4e5318))
- **java:** record canonical distribution rehearsal ([677aacb](https://github.com/DavidNiessen/doctopus/commit/677aacb4e871cb585122ad2c8defbfb5a28f1283))
- **java:** record prepared root-hosting release rehearsal ([76e54a8](https://github.com/DavidNiessen/doctopus/commit/76e54a8dee1f31df33b1024e9ccb523856562e00))
- **performance:** record current reader mobile budgets ([a8112b1](https://github.com/DavidNiessen/doctopus/commit/a8112b1a5b9ab8bb314a42f03f0082c2d131a3f0))
- **tooling:** clarify offline pnpm validation limits ([e8a115a](https://github.com/DavidNiessen/doctopus/commit/e8a115a4be1c18f072d4320783e3b1e1f868341c))
- record prepared container and hosted acceptance ([79c3272](https://github.com/DavidNiessen/doctopus/commit/79c32720f86b182c70f9008bf501f23c8a731785))
- record prepared recovery and performance acceptance ([1039881](https://github.com/DavidNiessen/doctopus/commit/10398817e95a3ebdc7716ce6040878ad921dd652))
- record prepared container inventory acceptance ([aed1f1d](https://github.com/DavidNiessen/doctopus/commit/aed1f1d567605d0bc36a1e260fbbbd85e2f948cf))
- record prepared fresh-target recovery acceptance ([011fcf1](https://github.com/DavidNiessen/doctopus/commit/011fcf11e253afaefc9d41d6ced94971d897c9af))

[Full changelog](https://github.com/DavidNiessen/doctopus/commits/v0.2.0-candidate.1)
