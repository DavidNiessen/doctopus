# Distribution version consistency

The pnpm workspace and lockfile are audited alongside `package-lock.json`: workspace inventory, direct dependency specifiers, internal links and shared security overrides must agree. Release preparation updates both locks offline while preserving external resolutions. See [local checks](../CONTRIBUTING.md#local-checks) for installation and dependency-update commands.

The repository uses one distribution version across the root, all npm workspaces and the Java reactor. `packages/contracts/src/version.ts` exports the runtime `toolVersion` used by the CLI, HTML generator metadata and compiler manifests. API documentation versions, plugin API versions and artifact schema versions have separate contracts.

```sh
npm run check:versions
npm run check:versions -- --json
npm run check:versions -- --release --json
```

The first two commands inspect metadata without writing files. Development allows Java's matching `-SNAPSHOT` suffix. `--release` requires the exact npm version in every Java POM, including prerelease qualifiers, with no snapshot suffix. The accepted `0.2.0-candidate.7` source passes that stricter mode. A passing version check establishes alignment; publication also requires the [release gates](releases.md).

Versions must be canonical SemVer. Build metadata is excluded because npm does not give it a separate distribution identity. Every internal dependency uses the exact unified version, including private workspaces. Public runtime, optional and peer dependencies cannot point to private packages. The npm lockfile must agree with workspace declarations, package inventories, versions, links and internal dependency references. The root Maven reactor declares the modules inspected by the checker; owned core dependencies use `${project.version}`.

`npm run check` runs this audit and the Node tooling tests before the compiler tests. npm candidate packaging repeats the audit and discovers public components from the same workspace inventory. It excludes private applications, refuses colliding archive filenames and checks the installed CLI, generator metadata and manifest against the packaged runtime version. Metadata symlinks outside the checkout are refused.

The version audit validates and reports alignment. The [release planner](releases.md#review-a-release-plan) also proposes semantic versions and Conventional Commit changelog notes without changing the checkout. The [release preparer](releases.md#prepare-the-reviewed-metadata) can stage, audit and apply a reviewed source-bound plan across npm/runtime/Java metadata and the changelog. Protected publication, signatures and provenance verification are separate gates; [prerelease .7](release-acceptance.md) passed them using the selected GitHub coordinates. The project is now Doctopus; the accepted release predates the rename and retains its original artifact coordinates. The audit and planner are read-only. Only an explicit preparer `--apply` edits metadata; none of these commands publish or create release tags.
