# Explorer authentication

The reader accepts API keys, basic credentials, bearer tokens and OAuth authorization code with S256 PKCE. OAuth/OpenID security schemes can also use a manually acquired bearer token. By default, navigation, modal closure and API-server changes clear operation credentials. Optional credential reuse stays within the current reader instance; copied snippets use placeholders. The target API still enforces token validity, scopes and permissions.

## Open the playground

Choose **Try now** beside the endpoint URL or in its request example card. The playground opens over the current documentation, with request fields and collapsible request snippets on the left and a read-only response editor on the right. On narrow screens the panels stack inside the modal. Add `?playground=open` to an endpoint URL to share the open playground; existing query parameters and fragments are preserved when opening or closing it.

Use the close button, Escape or the backdrop to dismiss the modal. Keyboard focus returns to the control that opened it. Closing discards request drafts, files and responses, cancels pending authorization, and aborts an in-flight browser or relay request. Authentication entries clear too unless credential reuse was explicitly enabled. An API may already have processed a request before cancellation; closing the playground does not undo server changes. Reopening starts a fresh request from the specification examples. The endpoint documentation and request example remain readable without JavaScript; sending requests requires JavaScript.

See the [response viewer and request URL bar](explorer-responses.md) for folding, syntax highlighting and full-response/URL copying.

## Choose a request transport

Requests originate directly from the browser by default. Sites with an explicitly configured [authenticated API relay](api-relay.md#reader-configuration) offer **Send requests from → Documentation server**. Choosing it checks documentation-session access without contacting the API. The notice explains that supplied API credentials and payloads pass through the server. Relay access requires an assigned project role even for public docs; target API authentication stays separate. Closing the playground resets the transport choice, and failed browser requests never switch automatically.

## Reuse credentials while browsing

Choose **Remember for 30 minutes in this tab** inside Authentication to reuse credentials between endpoints or after reopening the playground. Consent starts a fixed 30-minute window; typing does not extend it. Reuse is scoped to the API id/version, complete selected server URL, security-scheme definition and published OAuth client settings. OAuth scheme entries also require the same scope list. A different host, protocol, port, server base path or authentication policy does not receive the saved entry. Returning to a previously approved matching destination can restore it during the consent window.

Known OAuth expiry still applies while the modal is closed. Manually entered credentials have no inferred provider expiry; the API remains responsible for validity, scopes and revocation. Reuse does not renew a token or obtain additional permissions. The reader retains at most eight destination groups and 32 credential entries, with a 16-KiB value limit. Older groups are forgotten when capacity is needed. Oversized or invalid values remain in the current form and disable remembering for that destination.

The cache belongs to one reader instance. Credentials and consent are not written to localStorage, sessionStorage, cookies, IndexedDB, boot data or server artifacts. Reloading, leaving the page, reader teardown and expiry clear the retained entries. SPA navigation within the reader can reuse them. Route data declaring another documentation base path falls back to a full navigation and a fresh reader instance. Turning the checkbox off forgets the saved copy while retaining the current form until it closes.

Use **Clear all API credentials** in the playground or the header's **Forget saved API credentials** control to clear every remembered API destination. Clearing also removes current authentication entries and captured responses, cancels a pending OAuth flow, and aborts an active request. A request may already have reached the API; clearing does not undo its server-side effects.

Operators can hide this reuse feature while retaining ordinary authentication and PKCE:

```yaml
explorer:
  credentialReuse: false
```

## Register a public client

For an OAuth2 scheme with an `authorizationCode` flow, open **OAuth public client** in the playground. Set the public client ID and exact provider issuer, review the requested scopes, and register the displayed redirect URI with the provider. Then choose **Authorize with PKCE**. The provider must support public clients with PKCE and permit browser token requests through CORS. No client secret is needed or accepted in project configuration.

Defaults can be published in project configuration. The two mapping keys are the configured API id and OpenAPI security-scheme name:

```yaml
explorer:
  oauthClients:
    api:
      oauth:
        clientId: your-public-client-id
        issuer: https://identity.example.com
```

Scopes initially come from the operation's first alternative using that scheme and can be edited before authorization. Absolute authorization/token URLs come from the spec. Relative URLs resolve against the selected API server, treating its path as a directory; `/oauth/token` resolves at the server origin, while `oauth/token` retains the server base path.

Each export contains a static `<basePath>/oauth/callback/` page and a small callback script. That route is reserved, excluded from search/sitemaps and marked noindex. It removes query/fragment data from browser history before communicating with the opener. The reader requires the expected origin, exact popup window and state. A navigation or destination change cancels pending authorization; expanding request examples preserves the active flow and expiry timer. Acquired tokens clear at the declared expiry or through **Clear credential**. Without reuse, no-expiry tokens remain until cleared, closed or navigation; remembered tokens also have the bounded consent window above. Cancelling a replacement flow leaves an existing token unchanged.

Use HTTPS for the documentation and provider. Loopback HTTP is supported when the reader itself is served on loopback HTTP for development. Host authentication must permit the callback navigation, normally through the same reader session cookie. A proxy's `Cross-Origin-Opener-Policy` must allow the provider popup to retain its opener (for example, `same-origin-allow-popups` where appropriate). Redact callback query strings from proxy access logs. Popup blockers, missing CORS support or a lost opener produce an error without installing a token.

## Public-client PKCE protocol helpers

`@davidniessen/doctopus-explorer` exports `createPkceTransaction`, `calculatePkceChallenge`, `exchangePkceCode`, `resolveOAuthEndpoint` and their types. These are the protocol helpers used by the reader. A host using the helpers directly supplies its own popup/callback handling.

Create a transaction with the registered public `clientId`, exact `issuer`, authorization/token endpoint URLs, registered `redirectUri`, and required scopes. The authorization URL retains provider query parameters and sets the OAuth response type, state, client, redirect, scopes and S256 challenge. Verifiers and state use independent 32-byte Web Crypto random values. Keep the returned transaction in memory and never log, serialize or persist it.

The host must bind callback origin and window identity before passing its `URLSearchParams` to `exchangePkceCode`. The helper checks state, duplicate callback parameters, provider errors and an issuer parameter when present. Transactions expire after five minutes and are consumed once a token request starts. A failed exchange requires a new authorization flow.

Endpoints require HTTPS without URL credentials or fragments. Redirect/issuer URLs cannot contain query strings. Explicit `allowLoopbackHttp` permits development on `localhost`, `127.0.0.1` or `::1`; it does not permit arbitrary HTTP hosts. Token requests omit cookies, refuse redirects and abort after 30 seconds or the supplied signal. Responses must be successful JSON, are bounded to 64 KiB, and must contain a bearer access token of at most 16 KiB without control characters. Declared lifetimes must be positive safe integer seconds.

Only the access token and optional expiry are returned. Refresh tokens and ID tokens are discarded; this is access-token acquisition, not OpenID login or ID-token verification. Provider response values and arbitrary fetch exception details are omitted from errors. Keep returned tokens in memory, honor expiry and clear them on sign-out or reader teardown. Cancel abandoned authorization transactions on navigation. The reader’s explicit reuse option applies the additional destination and retention bounds above. These checks do not replace the independent security review required before a production release.
