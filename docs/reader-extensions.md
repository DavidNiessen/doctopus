# Trusted reader extensions

Reader extensions add optional page-change behavior and interactive footer widgets to the React reader. They use a separate browser-only SDK entry point and prebuilt ESM files. The builder copies and fingerprints those files without importing them. The reader loads them after hydration; projects without extensions load no extension runtime. Core pages remain readable without JavaScript.

## Trust and configuration

Extensions execute JavaScript with the documentation page's full origin privileges. They can access the DOM, session-accessible resources and values a visitor types. SDK capability names describe supported hooks; they are not a security sandbox. Review the entire module packet and its dependencies before publishing. The built-in SDK supplies only authored page metadata, without browser queries/fragments, API credentials, request/response bodies or documentation tokens. It makes no analytics calls.

```yaml
readerExtensions:
  - id: related-guides
    entry: extensions/related-guides.mjs
    files:
      - extensions/footer-tools.mjs
```

Build and preview with the existing explicit operator opt-in:

```sh
doctopus build my-docs --trust-plugins
doctopus dev my-docs --trust-plugins
```

`--trust-plugins` authorizes reviewed build plugins and reviewed browser extensions; `--trust-content` remains separate for executable MDX. Tooling using `--skip-plugins` omits browser extensions too. An ordinary project with no extension declarations needs no flag.

Declare at most eight unique IDs, each with a `.js`/`.mjs` entry and at most 16 additional JavaScript files. Paths must be canonical project-relative paths with ordinary non-hidden filename segments. Source escapes, missing files, duplicate declarations/files and invalid UTF-8 fail. The complete declaration fits within 64 files, 256 KiB per file and 2 MiB total. Bundle larger dependency trees into a small ESM output first. TypeScript/JSX and bare npm imports must be bundled or compiled by the extension author; the docs builder does not transpile or resolve them. Keep relative ESM dependencies in the same declared directory structure.

Every packet receives a content-addressed `reader-extensions/<id>/<digest>/` directory. Entries and declared dependencies join the artifact's ordinary checksum inventory and hosting allowlist. A second source read must match the compiled packet metadata before activation of the site build. Module edits receive new URLs; file/configuration changes trigger full development builds. No module code executes on the build host. Syntax/export/activation checks happen in the browser, so include browser validation in extension CI.

See [the runnable example](../examples/reader-extensions/). Its second extension intentionally fails activation to demonstrate failure handling; use only the reviewed modules your project needs.

## Browser API

A module's default export declares its ID, version, `pluginApi: '1'`, capabilities and activation function. The ID must match configuration. Supported SDK capabilities are `page` and `footer`:

```js
export default {
  id: 'related-guides',
  version: '1.0.0',
  pluginApi: '1',
  capabilities: ['page', 'footer'],
  activate(context) {
    const unsubscribe = context.onPageChange((page) => {
      // Immutable authored metadata: path, title, locale and kind.
      // path is relative to the publication base, without query or fragment.
      updateOptionalLocalState(page);
    });
    context.setFooter((page) => {
      const element = document.createElement('section');
      const heading = document.createElement('h2');
      heading.textContent = 'Related documentation';
      const text = document.createElement('p');
      text.textContent = page.title;
      element.append(heading, text);
      return { element, dispose() {} };
    });
    return unsubscribe;
  },
};
```

The illustrative `updateOptionalLocalState` function belongs to the extension. Prefer text nodes or a framework's escaped text rendering for authored values. Theme CSS variables such as `--text`, `--surface` and `--border` are inherited by widgets. Widget code owns its keyboard semantics, contrast and accessibility.

`context.basePath` is the publication mount path. `context.signal` aborts on teardown or activation failure. `getPage()` returns the latest frozen snapshot. `onPageChange()` requires `page`, immediately emits the current page and returns an unsubscribe function. Snapshots contain only `path`, title capped at 256 characters, locale and `guide`/`operation`/`lifecycle`/`not-found` kind.

`setFooter(factory)` requires `footer` and registers one factory for that extension. Each page change disposes the prior widget and mounts the returned `HTMLElement`; returning `undefined` hides it. A widget's optional synchronous `dispose()` releases its own resources. Registering another factory replaces the previous widget; the returned unsubscribe removes the current matching factory. Multiple extensions retain declaration order. Footer links with `data-doc-route` can use ordinary reader navigation.

`activate()` may return nothing, a synchronous disposer, or a promise for either. The built-in reader allows five seconds for module loading and five seconds for activation. A failure removes that extension's widgets/subscriptions and records a static console warning containing its ID. It does not expose exception values or prevent other extensions and core docs from running. Page-handler failures also dispose that extension. There is no automatic activation retry.

Navigation inside the reader updates page snapshots and recreates widgets. Reader teardown, `pagehide` and changed packet metadata dispose sessions. Activation cleanup that arrives after cancellation is still invoked. Loading/activation watchdogs prevent later SDK activation; they cannot interrupt JavaScript, cancel the browser's module evaluation or remove arbitrary side effects created outside the SDK. Use `context.signal`, widget disposers and activation cleanup for timers, global listeners and framework roots. Trusted extensions remain responsible for their own resource behavior.

## TypeScript and framework widgets

`@davidniessen/doctopus-plugin-sdk/browser` exports `ReaderPage`, `ReaderWidget`, `ReaderExtensionContext`, `ReaderExtension`, `defineReaderExtension` and `createReaderExtensionSession`. The subpath has no Node build-worker imports and can be used by browser bundlers. `defineReaderExtension` preserves typed context callbacks and validates metadata. Custom hosts can use `createReaderExtensionSession` with a widget-mount callback; the built-in React host additionally validates actual DOM elements and asset paths.

A bundled React extension can create its own root inside the provided footer element and return `dispose: () => root.unmount()`. Vue, web components and plain DOM code use the same element/disposer contract. Bundle runtime dependencies into the declared ESM packet. The docs reader does not expose its own React root or require sharing a React version with widgets.

Managed Node hosting already allows self-hosted module scripts through its CSP. Review CSP and content types on external static/framework hosts; no remote script origin is added automatically. Treat extension changes as privileged website code changes and retain the independent security/accessibility review and deployment acceptance gates.
