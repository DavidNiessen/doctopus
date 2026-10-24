# Bounded outbound HTTP transport

`requestAllowedOrigin` from `@davidniessen/doctopus-spec` is a Node-only transport shared by remote-spec imports and server integrations. It performs one HTTP exchange with explicit destination policy. It does not grant application permissions, expose a relay endpoint or accept browser sessions automatically; callers must authorize their own users, paths, methods and header policy before invoking it.

```ts
import { requestAllowedOrigin } from '@davidniessen/doctopus-spec';

const result = await requestAllowedOrigin('https://api.example.com/v1/items', {
  allowedOrigins: ['https://api.example.com'],
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: new TextEncoder().encode('{"name":"Example"}'),
  maxRequestBytes: 1024 * 1024,
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 30000,
});
```

Origins must be exact, without paths, wildcards, embedded credentials or fragments. HTTPS and public global-unicast addresses are required by default. HTTP and eligible private/loopback ranges require separate explicit options. Link-local, metadata, multicast, unspecified and unsupported reserved/transition ranges remain blocked, including when private access is enabled. Every DNS answer is checked before selecting a pinned address; mixed allowed/disallowed answers fail.

The configured proxy and `NO_PROXY` decision use the original URL, while the actual connection or proxy CONNECT destination uses the checked IP. Host and verified TLS/SNI identity retain the original hostname. The helper neither disables certificate checks nor replaces registry/proxy credentials or CA trust.

Supported methods are GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS. GET/HEAD cannot carry nonempty request bodies. Request bytes are copied before the asynchronous exchange. The default request limit is 1 MiB, configurable up to 32 MiB; the default response limit is 16 MiB, configurable downward. DNS, connection and response reading share a deadline of at most 30 seconds, with optional `AbortSignal` cancellation.

Request headers have a 64-field and conservative 16 KiB limit. Names match HTTP token syntax; values must be Latin-1 without forbidden controls, and case-duplicate names fail. The transport owns Host, Content-Length and identity Accept-Encoding. Cookies, hop-by-hop, protocol-upgrade, proxy/security and trusted forwarding headers are rejected. Target Authorization can be supplied explicitly; incoming application authentication is never inherited by this helper.

Responses are bounded before and during reading, with 16 KiB header parsing. Unexpected compression is rejected; there is no implicit decompression. HEAD and 304 representation lengths do not allocate response bodies. Protocol upgrades and tunnels are closed. Redirects are never followed: ordinary calls receive their status/body as metadata; `expectedStatus` can require a particular status before consuming a body. Remote-spec imports continue to require 200, verify optional digests and validate the source in the bounded worker.

Results contain status, origin, raw body bytes and parsed headers. Header arrays such as Set-Cookie are metadata only; nothing is applied to a cookie jar or browser. A server relay must filter response headers before exposing or applying them. There is no retry or persistent agent/cookie state. Connections are destroyed after completion/failure, and errors omit request bodies, header values, query strings and caller-supplied abort reasons.

This transport foundation does not enable the planned authenticated API relay by itself. The relay additionally requires operator allowlists, application authorization, request controls and an explicit reader opt-in.
