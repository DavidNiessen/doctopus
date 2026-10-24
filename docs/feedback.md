# Page feedback links

Static and server-hosted readers can display a configured **Report an issue** link on guide and API pages. It works in prerendered HTML without JavaScript. The feature is disabled by default and does not need an analytics service, database or hosted account with this project.

```yaml
feedback:
  url: https://github.com/your-org/docs/issues/new?template=docs.yml
  label: Report an issue
```

Choose an HTTPS issue tracker or feedback form. URLs must be at most 2,048 characters, without user information, whitespace padding or control characters. Labels are optional, nonempty and at most 60 characters. The destination and label are public configuration embedded in the publication; keep secrets out of them. The link opens a new tab with `noopener noreferrer` and a no-referrer policy. The reader does not submit a report, collect votes or contact the tracker in the background.

## Optional canonical page context

For trackers supporting a `body` query parameter, enable canonical context explicitly:

```yaml
siteUrl: https://docs.example.com
basePath: /developers
feedback:
  url: https://github.com/your-org/docs/issues/new?template=docs.yml
  includePage: true
```

The issue body then includes `Documentation page: https://docs.example.com/developers/<page-path>`. Existing configured body text and other tracker query parameters are retained. `includePage` requires an explicitly configured `siteUrl`; the browser's host is never used to infer it. Page context follows SPA navigation and direct page loads, but excludes browser queries/fragments, playground inputs, credentials, request/response bodies and local source filenames. Readers still review and submit their issue at the destination themselves.

Use the default context-free link for other trackers or private paths that should not leave the site. Canonical context is limited to generated reader paths and a final 4,096-character URL; invalid/excessive context falls back to the configured destination. Labels can use your site's language. All normal keyboard access, theme and mobile behavior applies.

The public `feedbackHref(config, pagePath)` helper from `@davidniessen/doctopus-contracts` shares the prerender/client behavior. Configuration validation is provided by `parseConfig` in `@davidniessen/doctopus-spec`. This link is an alternative to a feedback service, not a server-side submission or moderation API.
