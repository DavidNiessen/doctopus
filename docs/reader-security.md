# Reader data boundaries

In [direct framework mode](direct-integrations.md), the host serves bundled, inventory-verified UI assets and public runtime configuration. The browser downloads and parses a bounded, self-contained specification in a dedicated worker. Schema meta-validation is compiled during product development, so it requires no browser eval permission. Java/Node hosts do not fetch the configured spec URL. Direct mode needs JavaScript; compiled publications retain their server-rendered content.

The compiler validates configuration and sanitizes authored content before publication. The reader also checks HTML and navigation read from its bootstrap data and fetched page data. These checks complement publication verification and private-document authorization; they do not authenticate a compromised hosting origin or sandbox trusted browser plugins.

## Guide HTML

Both server rendering and browser rendering sanitize guide HTML with pinned DOMPurify 3.4.17 and the same policy. The policy retains ordinary HTML, authored component controls, accessibility attributes, heading anchors and documentation navigation. Scripts, SVG/MathML, embedded documents, forms, styles and event handlers cannot supply executable guide content. The policy is not read from page data.

The Node renderer uses JSDOM 30.1.3, with scripts and network resources disabled. It loads that DOM only when authored HTML is rendered and reuses one isolated instance per process. It does not install a global window. The browser build aliases the renderer adapter to native DOMPurify, so JSDOM and its server dependencies are excluded from the browser bundle. The reader memoizes sanitized HTML until its source changes.

## Navigation

Base-prefixed documentation links stay on the local origin. Navigation checks refuse executable schemes and embedded credentials, encode URI text and preserve existing escaped path/query values. Fragments remain local. Canonicalized paths emit one leading slash, including after dot-segment removal, so a pathname cannot turn into a scheme-relative host on a second parse. Invalid destinations fall back to safe `#` links.

The general reader navigation helper permits HTTP(S) destinations; project configuration continues to restrict authored header links to HTTPS or local absolute paths. Compiler configuration validation, browser credential destination checks and the explicit API explorer/relay rules remain separate controls.

## Source and artifact paths

Source confinement checks lexical membership before resolving the requested target, then checks canonical membership to reject escaping symlinks. A deliberately selected symlink project root and its canonical descendants remain usable. Lexically outside targets are refused before filesystem resolution; symlink targets are checked canonically before file contents are read. Staged artifact verification separately requires an exact 64-character lowercase hexadecimal identity before filesystem access.

The tests include malicious page-data HTML/links in a real browser, escaped and scheme-relative URI edge cases, authored component preservation, traversal/nonexistent targets and project-root aliases. See the [triage record](security-triage.md) for the scanner findings and validation still required, and [implementation progress](planning/04-progress.md) for dated results. Independent browser-code, accessibility and security reviews remain launch requirements.
