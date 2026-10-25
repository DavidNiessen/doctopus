# Public GitHub Pages demo

The public demo is intended for [davidniessen.github.io/doctopus](https://davidniessen.github.io/doctopus/). Deployment availability depends on repository Pages settings and successful GitHub Actions runs. The source is [examples/pages-demo](../examples/pages-demo), separate from the localhost API example.

## Verified public deployment

[Quality run 39983896039](https://github.com/DavidNiessen/doctopus/actions/runs/39983896039) passed all required jobs at `6f1e5ce`. [Deployment run 39984904851](https://github.com/DavidNiessen/doctopus/actions/runs/39984904851) deployed that exact tested demo artifact and passed all five browser journeys against the public Pages URL on 23 October 2026. This is development-demo evidence, with bundled fixture data and no live API service.

The later [published .7 acceptance](release-acceptance.md) includes signed candidate and actual registry-consumer verification. After documentation-only changes, [main 40118398261](https://github.com/DavidNiessen/doctopus/actions/runs/40118398261) passed all 15 jobs and [Pages 40118976356](https://github.com/DavidNiessen/doctopus/actions/runs/40118976356) passed deployment and hosted browser checks. All 28 deployed reader assets also match the exact published reader archive and original tested demo artifact byte-for-byte; hashes are recorded in the [release index](release-evidence/0.2.0-candidate.7.json). This asset comparison does not claim a registry-installed demo build or independent pilot acceptance.

## What visitors can try

The static site contains fictional Orbit projects and webhooks, authored guides, local search, API schemas, request examples, prepared themes, modern/classic layouts, resizable panels and the modal playground. **Send mock** generates a documented success response entirely in the browser. Mock controls also preview error statuses, named examples and seeded schema data. Highlighting, folding, fullscreen and complete-response copying work normally.

The demonstration explicitly configures:

```yaml
explorer:
  mode: mock
```

This mode prevents the reader's Send action from reaching live fetch/relay transport. Authentication controls and relay selection are unavailable. The displayed URL is read-only; even a changed published server cannot enable live requests. No credentials, backend or database are required. Mock generation ignores request inputs and does not create, update or delete resources. The illustrative `demo.orbit.invalid` address has no live service. Static page, asset and search requests still load from GitHub Pages.

Ordinary projects retain live sending by default; `explorer.mode: live` makes that choice explicit. Local mock-preview controls remain available alongside live sending. Mock mode is a demonstration feature, not a browser network sandbox for arbitrary custom scripts or styles.

## Build and preview locally

After installing the locked workspace dependencies:

```sh
pnpm run build
pnpm run demo:pages
pnpm run test:pages
```

The verified static root is `.doctopus/pages-demo/`. The build copies only the dedicated demo into temporary storage, applies the deployment origin/base path and removes the temporary project afterward. It replaces this generated output directory. The default URL derives from `GITHUB_REPOSITORY`, falling back to this repository. `PAGES_SITE_URL=https://docs.example.com/preview` overrides the build URL when testing another static host; it must be HTTPS without credentials, query or fragment. Custom-domain deployment additionally requires the corresponding GitHub Pages domain configuration.

To inspect the default build interactively, run `node scripts/pages-demo-browser-fixture.mjs` and open `http://127.0.0.1:4180/doctopus/`. This preview serves plain generated files and directory indexes, with no SPA fallback or API routes.

The dedicated browser suite blocks external requests and fails if one is attempted. It exercises direct/reloaded subpath links, 404s, local GET/POST/DELETE responses, error previews, server edits, classic playgrounds, exact response copy, fullscreen/folding, local search, theme matching, mobile accessibility and reading without JavaScript.

## Deployment pipeline

The **Repository quality** workflow builds and tests the static demo on branch pushes, pull requests and merge queue candidates. Its **Static mock demo** job is required by the aggregate **Quality** check. It uploads the verified site under a name containing that checkout's commit SHA.

After a successful quality run for a **push to master**, **Deploy public demo** downloads that exact run's artifact and deploys it to the `github-pages` environment. Artifact preparation and deployment do not rebuild or execute downloaded repository code. Pull requests, forks, failed runs and manual quality dispatches cannot deploy. Actions are pinned by SHA. Only the deployment job receives Pages write and OIDC permissions; artifact preparation uses read permissions.

A separate **Verify hosted mock demo** job checks out the exact tested source with read-only permissions and no persisted checkout credentials. It waits for the public URL and runs the same five browser journeys against that deployed site, without rebuilding it or starting a local server. It checks direct guide/endpoint routes, mock-only GET/POST/DELETE behavior, complete response copying/folding/fullscreen, classic layout, search, prepared themes, mobile accessibility and content without JavaScript. Browser requests to other origins are rejected and reported. Ubuntu 24.04 hosted runners supply the shared browser libraries; CI downloads the Chromium revision pinned by Playwright without upgrading OS packages or installing extra font bundles. A missing runtime library still fails browser launch. Reports/screenshots are retained for seven days; a failed hosted check makes the deployment workflow fail even if Pages accepted the artifact.

To repeat those checks against the public site after installing the pinned dependencies and Playwright Chromium:

```sh
PAGES_DEMO_URL=https://davidniessen.github.io/doctopus/ pnpm run test:pages
```

`PAGES_DEMO_URL` selects an existing HTTPS publication without credentials, query or fragment; the path is normalized to a trailing slash. Explicit loopback HTTP is also supported for acceptance fixtures. Omitting it retains the ordinary local static-preview tests and their verified generated artifact. These tests load public documentation only and never need deployment or API credentials.

Repository maintainers must enable **Settings → Pages → Build and deployment → Source: GitHub Actions** and allow deployments from `master` in the `github-pages` environment. Existing environment approval policies remain effective. Actions billing/spending restrictions must also permit the quality jobs to run. Repository files alone cannot grant this session access to Pages settings or remove billing restrictions.

Once enabled, a successful main pipeline publishes the demo automatically. To retry a failed deployment without a new commit, rerun the associated quality workflow; the successful completion triggers deployment again.
