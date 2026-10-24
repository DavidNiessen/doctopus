# Publication manifest and integrity

Each publication contains `manifest.json`, SHA-256 digests for its files, an input-model digest, routes, diagnostics and plugin provenance. The artifact digest identifies that metadata, including the complete file-digest map. Digest verification establishes content integrity. Obtain approved digests through trusted build/release procedures when authenticating what should be deployed.

## Manifest version 2

Current builds emit version 2. Node and Java use the following portable identity algorithm after validating the metadata shape:

1. Select `schemaVersion`, `compilerVersion`, `inputDigest`, `files`, `routes`, `diagnostics` and `plugins`. Exclude `artifactDigest` itself.
2. Sort object keys recursively by UTF-16 code units. Numeric-looking keys keep textual order, so `1`, `10`, `2` is correct. Preserve array order and string contents without Unicode normalization.
3. Serialize compact JSON without whitespace. Strings use JSON escaping for quotes, backslashes, controls and unpaired surrogates. Keep valid Unicode, including U+2028/U+2029, as UTF-8 characters. Do not add HTML escaping for `<`, `>`, `&` or `=`. The sole numeric metadata field is `schemaVersion: 2`; other metadata values follow the declared string/array/object shape. Omit absent optional properties.
4. Hash those UTF-8 bytes with SHA-256 and use lowercase hexadecimal output.

Version 2 rejects unknown root and nested diagnostic/plugin/input fields. New identity-bearing extensions require an explicit format change. Files use canonical relative ASCII paths without traversal, hidden segments or empty path components. Metadata limits are 200,000 files, 100,000 routes, 10,000 diagnostics and 32 plugins; manifest files are bounded to 16 MiB. The byte limit can be reached before the element limits.

The shared [Java/Node vector](../integrations/java/core/src/test/resources/manifest-v2-vector.json) fixes the expected digest and canonical bytes for reordered metadata, numeric-looking file names, non-ASCII characters, controls and unpaired surrogates. The tests verify the literal vector digest independently and both implementations consume it.

## Migration from version 1

Node verification retains version 1 support for existing staged publications and rollback. Its original identity uses locale-sensitive file ordering and is not a portable algorithm for new framework implementations. Current builds always create version 2 and therefore a new artifact digest. Preserve older immutable directories until their rollback/retention period ends.

The updated Java adapter requires version 2 and rejects version 1 with a rebuild instruction. Rebuild the original project with the current CLI, verify its new digest, then deploy that artifact with the updated adapter. This is a pre-release format migration; no automatic in-place rewriting of published artifacts occurs. Project configuration and reader page-data versions remain unchanged.

## Java verification and digest pinning

Java validates the complete manifest identity before trusting its file allowlist, then hashes all listed payload files. It rejects malformed/duplicate-key manifests, non-regular manifest inputs, invalid UTF-8 and excessive metadata. It reads the base-path configuration by streaming past the aggregate site graph rather than loading every guide and schema into Java memory.

`new Publication(directory, trustedDigest)` requires an independently obtained SHA-256 artifact digest. Spring Boot exposes the same optional pin through `doctopus.artifact-digest`. A mismatched pin fails startup. `Publication.artifactDigest()` exposes the verified identity for inventory and diagnostics. Reading a digest from the same untrusted artifact does not establish its authenticity.

Keep publication directories immutable and read-only after verification. Startup checks do not protect against a process that can rewrite files later. Host authentication still applies to every page, search index, callback and asset; digest verification does not grant reader access or replace signature verification and protected release procedures.
