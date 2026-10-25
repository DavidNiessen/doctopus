# Response viewer and request URL bar

Choose **Try now** on an endpoint to open the playground. Its right panel shows **Your response will appear here** until a request receives a response, then displays the status, duration and a read-only Monaco editor. Request snippets are available in the collapsible **Request example** section on the left.

The request pane also offers optional [local mock previews](mock-responses.md) from examples or seeded schema data. These are labeled as mocks and use the same editor/copy controls; the URL bar's Send action remains a live request by default. With `explorer.mode: mock`, **Send mock** generates a local preview instead; see the [static demonstration](pages-demo.md).

## Read, fold and copy responses

JSON, XML and HTML responses use syntax highlighting selected from the response Content-Type. Other media types use plain text. Fold indented sections with the gutter controls or **Collapse all**; **Expand all** restores them. Editing is disabled. The editor follows the reader's light/dark mode, resizes with the modal, and releases its model when the response changes or the modal closes.

**Copy entire response** copies the original decoded response body, including folded content, whitespace and precise number tokens. Formatting the displayed JSON does not change the copied text. JSON formatting preserves large integers and decimals instead of converting them to JavaScript numbers. Malformed, duplicate-key or excessively complex JSON remains raw. Formatting uses the bounded JSON parser: at most 1 MiB, 32 levels and 10,000 values; raw display remains available within the playground's response limit.

Requests still time out after 30 seconds and captured responses remain bounded to 2 MiB. A truncated response contains an explicit marker; copying includes the captured content and marker, not bytes beyond that limit. Response headers remain available separately. An empty HTTP response is a valid response with an empty editor and an empty copied body.

Monaco, its worker, syntax definitions and icon font are self-hosted with the reader. They load only after a response needs displaying; reading documentation and opening an empty playground do not load the editor. No CDN or remote JSON schema service is used. If editor assets cannot load, a plain-text fallback preserves the response and full-copy action. Clipboard denial displays a message so the text can be selected and copied manually.

## Inspect and copy the destination

The Unified bar combines the HTTP method, host, resolved path, encoded query, URL copy action and Send button. Changing the API server or parameter fields updates it. URL resolution does not depend on whether a request body or selected upload is complete. Invalid destinations or unresolved parameters disable URL copying and sending until corrected.

**Copy request URL** copies the complete displayed URL. Authentication values use placeholders in displayed/copied URLs; sending uses the credentials entered in the authentication fields. Ordinary path/query values retain the specification's serialization and URL encoding. The HTTP method comes from the documented operation. Change the server and parameter fields to configure the destination.

## Browser build dependencies

Monaco and DOMPurify are pinned development dependencies because their browser code is compiled into reader assets; installed server consumers do not compile the editor. The Vite build replaces Monaco's vendored sanitizer with the separately pinned, patched DOMPurify. The notices collector refuses a build containing the vendored copy or missing the patched dependency and includes both libraries' license text. Dependency audits and installed-package checks remain release gates; the reader's initial bundle and the lazy editor have separate performance costs.
