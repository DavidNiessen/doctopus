# Reader languages and UI translations

This guide describes translated compiled publications and authored guide trees. Basic [direct integrations](direct-integrations.md) use the bundled English Reader and application settings; choose a compiled publication for the multilingual authoring workflow below.

Projects can customize the core reader labels without JavaScript plugins or remote translation services. `defaultLocale` selects the HTML language and the UI message catalog. The current catalog covers navigation/search, personal settings and prepared appearance presets, classic endpoint lists, schema-reference and lifecycle guidance, playground/URL-bar actions, response-editor controls, clipboard feedback and the page footer. Advanced body-editor and administration wording still uses English. Configured locales generate reader routes and a language menu. Guides can have authored locale variants. Missing guide variants and API content use the default-locale sources with an explicit fallback notice when the UI language differs. Source files are never translated automatically.

## Locale routes and content fallback

Default-language URLs stay unchanged. With `basePath: /docs`, `defaultLocale: en` and `locales: [en, de]`, a guide remains at `/docs/guides/start/`; its German UI is at `/docs/de/guides/start/`. The prefixed route selects German messages and the matching authored guide variant. A missing variant displays the English source with an explicit fallback notice. The content article retains its source-language attribute. The default locale does not get a redundant prefix.

The header language menu uses ordinary links, so it works without JavaScript and starts a fresh reader instance. Switching languages keeps the current guide, operation or lifecycle page, drops URL queries/fragments and clears playground drafts, responses and remembered API credentials. It does not acquire credentials or issue an API request. Subsequent reader navigation and search-result links retain the selected locale. Authored links inside source content retain their authored destinations.

All generated locale HTML/page-data routes belong to the same verified artifact and hosting allowlist. Assets, search shards, `site.json` and the OAuth callback keep their existing unprefixed locations under `basePath`; a locale prefix does not grant access to additional files. Without authored guide variants, search uses the shared source-language corpus. A configured guide locale gets `search/<locale>/catalog.json` and inventoried shards containing its resolved translated/fallback guides plus source API descriptions. Search-result links retain the selected UI language. Projects without guide variants retain incremental updates across all locale routes; translated projects currently use a full development rebuild for every source edit. The existing artifact ceilings of 100,000 routes and 200,000 files still apply after expansion.

Routes showing source-language fallback content use `noindex,follow`, canonicalize to the default-language page and stay out of the sitemap. They are not advertised as fully translated SEO alternates. Authored guide variants use their own canonical URL and index policy, enter the sitemap and expose reciprocal `hreflang` links only for available source/translated guide pages. These metadata links also update during SPA navigation. The verified generic 404 document uses the default language; unknown locale/page paths remain 404s and their language-menu links lead to a valid localized home page.

## Author translated guides

```yaml
locales: [en, de]
defaultLocale: en
guides: guides
i18n:
  guides:
    de: translations/de
```

Keep the default guide at `guides/start.md` and its German variant at `translations/de/start.md`. Relative paths and slugs identify the same page; translated titles, descriptions, groups, headings and body text can differ. The default guide ordering remains stable. A missing `translations/de/authentication.md` resolves to `guides/authentication.md` with the fallback notice. The language menu reports the current page's content language separately from core UI message coverage.

Guide roots must be existing project-local directories for configured non-default locales, and must not overlap the default guide directory. Paths remain confined to the project. Orphan or duplicate translated slugs fail the build. Content locales use exact configured identifiers; UI message catalogs can additionally use their base-language fallback. The `messages` map defaults to empty when only guide roots are configured.

Default and translated sources share the existing limits: 25,000 directory entries, 10,000 total guide instances, 64 MiB of source text and 2 MiB per guide. Symlink refusal, Markdown sanitization and explicit `--trust-content` for MDX apply to translated roots too. Trusted graph plugins may supply or transform guide variants; duplicate/orphan/undeclared variants and budgets are validated, and their HTML is sanitized through the same compiler boundary.

Relative Markdown links between translated files retain the locale prefix. They can point at a missing variant when its default-language page exists. Doctor checks the actual localized anchors and validates translated links. Shared media stays under the publication's ordinary `/media/` path; authored absolute destinations retain their declared meaning.

`site.json` contains the full multilingual graph. Per-page payloads contain only the resolved navigation and active guide body, content language, search locale and small alternate-link metadata. Other locale bodies are omitted. Search assets are generated one corpus at a time. Failed builds retain the prior artifact. Development rebuilds are deliberately full for projects with guide roots so edits cannot leave stale translated pages or search data.

The [example](../examples/localized/) has a German source introduction with an English variant and a German authentication page that still falls back in English UI. OpenAPI descriptions and advanced product wording are not automatically translated.

## Configure messages

```yaml
locales: [en, de-DE]
defaultLocale: de-DE
i18n:
  messages:
    de:
      navigation.docs: Dokumentation
      search.label: Dokumentation durchsuchen
      search.placeholder: Dokumentation durchsuchen…
      playground.try: Jetzt testen
      playground.dialog: '{title} testen'
      playground.send: Senden
      response.copy: Vollständige Antwort kopieren
    de-DE:
      playground.send: Anfrage senden
```

See the [German example](../examples/localized/docs.config.yaml). The example is a partial project-authored catalog, not a claim of a reviewed complete German translation. Source guides and OpenAPI summaries remain authored content.

Resolution is exact locale, its base language, then the bundled English message. A missing key falls back individually. Regional overrides do not erase base-language keys. English defaults and existing URLs/accessible names remain unchanged when no messages are configured. The renderer and browser use the same catalog, with no language detection, storage, network requests or global locale state.

Supported locale identifiers use two lowercase language letters and an optional uppercase two-letter region, such as `de` or `pt-BR`. Configure 1–16 distinct locales and include `defaultLocale`. Message catalog keys must target a configured locale or its base language. Every message key is validated against the public catalog; unknown keys, empty text, control characters and values above 512 characters fail the build. Do not put secrets in messages: they are public artifact configuration.

## Settings and classic reference messages

The `settings.*` and `appearance.*` IDs cover the personal appearance-mode, prepared-theme and layout selectors, their dialog controls and browser-storage status. `classic.*` covers the collapsed endpoint list, counts/pagination, deprecated badges, loading states, retry errors and permalinks. These use the same exact/base/English fallback and named-parameter validation as other reader messages, including accessible names. The [German example](../examples/localized/docs.config.yaml) demonstrates these messages; independent linguistic review remains a launch gate.

Message overrides change display text. Theme preset IDs, layout/mode values, configuration keys and endpoint paths retain their public values. Authored API titles, tags and descriptions remain literal source text. Existing valid mode, layout and preset preferences are shared across this project's language routes. Removed custom-theme/editor controls are no longer rendered; their previous catalog IDs remain accepted for configuration compatibility.

Pagination exposes named values (`{page}`, `{pages}`, `{count}`), so translators can reorder labels. Counts do not currently provide ICU plural rules; use wording that works for all counts, such as `Endpunkte: {count}`. Loading/retry feedback retains semantic state and resolves its current label when rendered. Advanced body editors and Studio administration still have English product wording.

## Endpoint reference and parameter controls

`api.*` covers endpoint authorization notices, parameter-section headings, fallback parameter descriptions, request-body/response headings and incoming-event example labels. `parameter.*` covers accessible input names, value placeholders, optional presence/empty-value actions and draft/empty guidance. Named context retains the parameter name and wire location while allowing translated wording and order. The same reference headings render before JavaScript loads and inside classic endpoint details.

`examples.*` covers response example selectors, generated titles and the explanation that external example URLs remain offline. Authored example names/summaries, values, security-scheme identifiers, media types and path/query/header/cookie wire identities remain literal. Generated/inline display labels are localized by their stable example IDs; a matching authored label is not rewritten. `code.*` covers code-copy controls and clipboard failures; copying retains the exact displayed code.

The German example demonstrates these labels and an optional `limit` query parameter. Browser acceptance checks translated inclusion controls, retained drafts, exact query URL/code copying, mobile accessibility, English fallback and reference headings without JavaScript. SDK validation errors, advanced body editors and Studio wording retain their existing English fallback. This does not establish complete linguistic or right-to-left acceptance.

## Authentication and relay controls

`auth.*` covers credential inputs, public OAuth client settings, popup controls and controlled acquisition/expiry/clear feedback. `credentials.*` covers opt-in reuse and clearing status. `relay.*` and the request-configuration `playground.*` messages cover transport selection, explicit access rechecks, server selection and controlled relay failures. Status and error codes resolve through the current catalog when rendered; public SDK validation diagnostics retain their English fallback.

Translations never change security-scheme names, client IDs, issuers, scopes, redirect URIs, server URLs or credential values. Credentials remain memory-only, reuse remains opt-in and destination-bound, and failed relay requests require an explicit retry. Displayed expiry times use the selected locale while the machine-readable timestamp remains ISO. Tokens cleared by the credential store and by the field timer both report expiry consistently.

The German example includes bearer and public authorization-code alternatives plus an optional authenticated relay. Browser acceptance exercises real PKCE acquisition, exact callback/scope values, credential expiry and clearing, absence of persistent secrets, denied-access recovery, explicit relay retry, exact response copying and mobile accessibility. These fixture integrations do not provide a production identity provider or relay service.

## Schema and lifecycle guidance

`schema.*` IDs cover descriptive type fallbacks, boolean schemas, required/deprecated badges, enum guidance, composition explanations, child attributes, recursion/depth boundaries, tuples and conditional/dictionary labels. JSON Schema keywords and type identifiers, authored property names/descriptions, enum/constant values and reference identities retain their original spelling. Messages and literal values render as escaped text.

`lifecycle.*` IDs cover operation notices and the deprecation center: status/date explanations, migration/replacement links, filters, result context, pagination, empty states and unavailable guidance. The heading uses `navigation.deprecations`. Source operation/API titles, methods, paths, lifecycle messages and ISO dates remain authored values. Named context allows result labels and pagination to reorder their values. Count labels have explicit one/other forms; projects can use wording suitable for all counts where their language needs more plural categories.

Server-rendered pages retain clock-independent declarations and a translated no-JavaScript explanation. After hydration, the same UTC status calculation resolves the selected message. Language prefixes remain on lifecycle filters, pagination, operation/replacement links and local migration guides. Ordinary links and localized reference text work without JavaScript. The German example and browser fixture exercise these controls; independent linguistic review remains required.

## Named parameters and plain text

Some messages require named context, such as `{title}`, `{count}`, `{method}` or `{origin}`. Keep the original names; translated text can reorder them. Validation rejects missing or substituted parameter names. Values are inserted literally once, so a value containing another placeholder does not trigger recursive substitution.

Messages render as text, including accessible labels and confirmation dialogs. They cannot contain executable expressions, HTML components, Markdown or formatting instructions. Literal `<` and `>` characters are escaped by React, and boot configuration is encoded safely in the HTML document. Changing the close-button label does not change its focus behavior: the modal uses a stable DOM marker.

## Public message API

`@davidniessen/doctopus-contracts` exports `defaultUiMessages`, `createUiTranslation`, `validUiMessage`, `UiMessageKey`, `UiMessages`, `UiConfiguration`, `UiText` and `UiTranslation`. Inspect the default catalog to obtain the supported stable IDs and English values:

```js
import {
  defaultUiMessages,
  createUiTranslation,
} from '@davidniessen/doctopus-contracts';
console.log(JSON.stringify(defaultUiMessages, null, 2));
const ui = createUiTranslation('de-DE', config.i18n);
console.log(ui.text('playground.dialog', { title: 'Create project' }));
console.log({
  translated: ui.translated,
  fallback: ui.fallback,
  total: ui.total,
});
```

TypeScript checks named arguments for each message. Coverage counts describe this core message catalog, not all product text or translated documentation. For English locales the bundled catalog supplies every entry; other locales count valid exact/base overrides. The public helper ignores invalid runtime overrides and inherited message keys. Configuration validation remains the recommended entry point.

Full text direction/layout acceptance and independent linguistic/accessibility review remain separate release work. Do not advertise a fully localized language solely because its identifier is configured.

## Public route helpers

`localeRoute(config, path)` returns the selected locale, prefix and source `contentPath`. `localizePath(config, path, locale)` changes the locale prefix and rejects unconfigured languages or paths containing queries/fragments. `localePaths(config, path)` enumerates default/alternate variants. Inputs are paths relative to the publication base path, not filesystem paths or absolute URLs. These helpers do not authorize routes; the artifact manifest remains authoritative. `localeName(locale)` supplies stable native menu labels without server/browser ICU differences.

## Public content helpers

`guidesForLocale(site, locale)` resolves an authored guide view over the full compiler graph. `pageContentLocale(site, path)` identifies the active content language. `guideAlternates(site, path)` returns available guide-language links; `validateGuideTranslations(site)` checks variant identities, declared locales and shared source budgets. `createSearchIndex(site, locale)` optionally selects the resolved guide corpus; the omitted locale retains the default-language behavior. Route-scoped data already contains the resolved view and intentionally omits the full variant map.
