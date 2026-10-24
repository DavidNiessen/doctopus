# Pinned external-reference snapshots

`doctopus vendor-spec` explicitly imports an OpenAPI 3.0/3.1 YAML or JSON root and its reviewed external reference documents. Every source has an exact URL and mandatory SHA-256 pin. The command validates the complete cached graph before recording a ready snapshot. Builds, doctor and preview use only local, hash-verified files; compilation never refreshes upstream sources.

For a self-contained document, the simpler [remote importer](remote-import.md) remains available. Local project references keep their existing behavior without this feature.

## Review and import

Prepare a project-local YAML or JSON policy. Replace both example hashes with independently reviewed SHA-256 digests of the exact source bytes:

```yaml
schemaVersion: 1
root: https://api.example.com/openapi.yaml
sources:
  - url: https://api.example.com/openapi.yaml
    sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  - url: https://schemas.example.com/models.yaml
    sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
```

The root must be listed. Include every transitive reference document; the command fetches all listed documents, including unused ones, and refuses unlisted references. Relative references resolve against each document's original URL. Origins and credentials are operator inputs outside the policy:

```sh
doctopus vendor-spec reference-policy.yaml . \
  --allow-origin https://api.example.com \
  --allow-origin https://schemas.example.com
```

`--output specs/snapshots` selects another canonical project-relative directory. The default is `spec-snapshots`. The command prints two configuration paths without source URLs or credentials:

```yaml
specs:
  - id: public
    path: spec-snapshots/<printed-digest>/source-0.yaml
    references: spec-snapshots/<printed-digest>/snapshot.json
```

Use the actual printed digest, not the placeholder. Both paths are required and must identify the same snapshot root. The directory contains `snapshot.json` and numbered source files. All source files use a `.yaml` suffix because YAML accepts JSON; bytes, formatting and numeric tokens are preserved exactly. Semantic normalization retains the compiler's existing numeric behavior.

Keep the policy and complete snapshot in source control or another reviewed build-input store. Generated documentation does not copy the raw snapshot into the publication; configured paths remain ordinary project metadata. As with any spec, authored URLs/descriptions/examples may appear in generated documentation.

## Authentication and network policy

Set a selected environment variable through your secret manager, then bind it to one exact canonical source URL:

```sh
doctopus vendor-spec reference-policy.yaml . \
  --allow-origin https://api.example.com \
  --allow-origin https://schemas.example.com \
  --bearer-env 'https://api.example.com/openapi.yaml=SPEC_DOWNLOAD_TOKEN'
```

The binding sends a bearer header only for that document. It is not inherited by another path or origin. Repeat the flag for each source requiring authentication. Missing variables, unknown sources and duplicate bindings fail before any request. The policy cannot select environment variables or supply credentials. Tokens and variable bindings are not written into the snapshot. Full original URLs, including query strings, are stored in the manifest: use bearer environment bindings instead of secret query parameters.

HTTPS and public destinations are the default. Exact allowed origins are checked before downloading anything. DNS answers are checked and connections pinned; redirects, protocol upgrades and compressed responses are refused. Eligible loopback/private generators require `--allow-private-network`; HTTP additionally requires `--allow-http`. Ambient cookies are not forwarded. Existing proxy and CA settings remain in effect without an automatic direct fallback. See [outbound HTTP](outbound-http.md) for the transport contract.

## Limits and supported references

A policy is at most 64 KiB and lists at most nine documents including the root. Downloads share a 16 MiB total byte budget and a 30-second download/validation deadline. The validation worker limits old-generation heap to 256 MiB and stack to 4 MiB; these are runtime limits, not a whole-process memory guarantee. Parsing retains the ordinary UTF-8, YAML alias/tag/key and nesting limits. The combined expanded graph is bounded to 64 MiB of serialized JSON and 1,000,000 value nodes.

Plain JSON Pointer `$ref` fragments, relative references, transitive references and recursive schemas are supported. Resolution reads only the in-memory approved document map. It has no filesystem or HTTP fallback. OpenAPI 3.2, custom URI schemes, named fragment anchors and URI-rebasing/dynamic-reference semantics are unsupported. The conservative check rejects string-valued `$id`, `$anchor`, `$dynamicAnchor`, `$dynamicRef` and `$recursiveRef` anywhere in the graph, including examples. Schema properties with those names and object-valued definitions remain valid. External example/media URLs are metadata and are never fetched.

The frozen loader repeats manifest, path, inventory, length and SHA-256 checks and bundles only the cached sources. Source plugins receive the optional `references` path and may transform root text after the original pinned bytes are verified; they cannot add unapproved external references through this resolver. Trusted plugins still have their documented build-user privileges.

## Refresh, recovery and programmatic use

To refresh, review new source hashes, import again and update both configuration paths to the new digest directory. Existing snapshots and configured builds remain unchanged. Reordering a policy does not change the snapshot identity. Repeating an import still downloads and validates upstream bytes before reusing a matching complete local snapshot; ordinary builds need no network.

Files are created with mode `0600` and never overwritten. A ready snapshot has an exact file inventory; extra files, symlinks, conflicting bytes or tampering cause failure and preserve local files. `snapshot.json` is linked last as the readiness marker. An interrupted import may leave matching partial source files; rerunning the same approved import can finish that cache. Inspect and resolve a stale per-digest lock manually after a process crash. Do not edit a completed snapshot or place notes inside it. Existing publications remain available when a later build fails.

`@davidniessen/doctopus-spec` exports `parseReferencePolicy`, `downloadReferenceSnapshot`, `loadReferenceSnapshot`, `parseReferenceManifest` and the associated types. The downloader accepts required `allowedOrigins`, optional explicit `allowHttp`/`allowPrivateNetwork`, exact-URL `credentials`, cancellation and lower `maxBytes`/`timeoutMs` limits. It returns the manifest and raw source buffers without writing files. `@davidniessen/doctopus-cli` exports `vendorRemoteSpec(project, policy, options)` for the immutable cache workflow. `loadSpec(project, { id, path, references })` performs offline loading. Isolate untrusted builds even when their references are frozen.
