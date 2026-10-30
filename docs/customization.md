# Branding, themes and discoverability

For an existing Spring Boot or Node application, configure direct-mode branding through [application properties or adapter options](direct-integrations.md#runtime-options). The header title, description, logos, favicon, prepared theme, initial layout and appearance need no project config file or documentation rebuild. Restart the integration to apply changed application settings.

The remaining sections describe optional compiled/static publications. Their publisher configuration uses YAML or JSON, supports additional theme tokens and custom CSS, and is validated during build and doctor checks.

Prepared theme IDs now select complete light/dark palettes, including backgrounds, panels, borders, text, accents and editor colors. The Reader and Studio display Violet, Ocean, Ember (`ember`) and High contrast (`contrast`). System appearance remains the default and follows OS changes; readers can override it independently. **Site default** preserves published palette overrides. See [Reader themes](reader-layout.md).

## Theme tokens

```yaml
theme:
  preset: ocean
  accent: '#2563eb'
  radius: 12
  density: comfortable
  font: system
  codeTheme: dark
  sidebarWidth: 274
  contentWidth: 760
  colors:
    light:
      background: '#ffffff'
      surface: '#f8fafb'
      text: '#202a35'
      muted: '#596572'
    dark:
      background: '#101316'
      surface: '#161b20'
      text: '#cbd3dc'
      muted: '#a1adba'
```

Prepared themes are `violet` (default), `ocean`, `ember` and `contrast`. Legacy `mint` and `neutral` IDs remain accepted and select Ember and High contrast. An explicit accent overrides the preset. Palette overrides apply after the default light/dark palette. Available palette tokens are `background`, `surface`, `subtle`, `border`, `text`, `muted`, and `heading`. Colors use six-digit hex notation. Text, muted and heading colors must reach WCAG 4.5:1 against all three reading surfaces; insufficient contrast fails configuration validation. Accent text and focus indicators derive readable colors while retaining the brand hue. Decorative accents retain the configured color.

Density supports `comfortable` and `compact`; font supports `system`, `sans` and `serif`. System fonts need no third-party request. Radius is 0–24 px, sidebar width 220–320 px, and guide content width 600–960 px. Responsive layouts override desktop sizing where necessary. `codeTheme` chooses dark or light treatment for the shared documentation code blocks.

## Logos, fonts and custom styles

```yaml
assets: public
logo: brand/logo.png
logoDark: brand/logo-dark.png
favicon: favicon.png
theme:
  preset: violet
  stylesheet: brand.css
```

Asset names are relative to the configured source directory. The builder copies them under `/media/`, validates their references, and includes their digests in publication provenance. The dark logo is optional and requires a default logo. The visible project name supplies the accessible brand label.

Supported assets are PNG, JPEG, GIF, WebP, ICO, AVIF, WOFF/WOFF2, TTF/OTF and CSS. Raster image signatures must match their extension. Files and directories use URL-safe names. Symlinks, executable HTML/JavaScript, SVG and other unsupported formats fail explicitly; convert vector branding to a raster image or use a separately reviewed reader extension. The public directory is optional if no assets are configured. It must contain only files intended for publication. Limits are 16 MiB per file, 64 MiB total, 2000 entries and 16 directory levels.

Custom CSS loads after the default reader stylesheet. Scope rules under `.docs-shell` to keep them specific to documentation. Use the theme variables (`--bg`, `--surface`, `--text`, `--muted`, `--heading`, `--border`, `--accent`, `--accent-text`, `--radius`) and stable component classes documented by the shipped example. For self-hosted fonts, put the font in `public/fonts` and use a relative URL from `public/brand.css`:

```css
@font-face {
  font-family: 'My docs font';
  src: url('./fonts/docs.woff2') format('woff2');
  font-display: swap;
}
.docs-shell .article {
  font-family: 'My docs font', system-ui, sans-serif;
}
```

CSS can change readability and load resources permitted by the deployment's CSP. Review it as trusted publication content. Token validation does not certify arbitrary stylesheet overrides. React component-slot and fully custom theme APIs remain separate roadmap work.

## Canonical URLs and indexing

```yaml
siteUrl: https://docs.example.com
basePath: /manual
seo:
  index: true
  socialImage: social-card.png
```

`siteUrl` is the external HTTPS origin. The separate `basePath` supplies any mounted documentation path. Page HTML includes canonical URLs, descriptions, Open Graph metadata, a Twitter card type and the configured favicon/social image. Client navigation updates the title, description and canonical metadata. Unknown pages use `noindex,nofollow` and have no canonical URL.

When indexing is enabled and `siteUrl` is configured, the builder emits an absolute-URL `sitemap.xml` for real pages and references it in `robots.txt`. Redirects and error pages are excluded. With `seo.index: false`, HTML carries `noindex,nofollow`, robots disallows crawling, and no sitemap is emitted. An omitted `siteUrl` produces no absolute canonical URLs or sitemap, which is useful for local/offline deployments.

Robots directives are hints, not access control. Protect every private artifact with the server or an authentication gateway. When serving docs below a path on a shared host, configure the origin's root `/robots.txt` to reference the appropriate sitemap or exclusions; crawlers do not automatically discover a nested robots file.

## Reader appearance presets

Visitors can open **Reader settings** to choose the published theme or a complete Violet, Ocean, Ember or High contrast palette, alongside system/light/dark appearance and modern/classic layout. Preferences stay in their browser and synchronize across tabs for the same documentation base path. Response editor colors follow the selected theme automatically.

Custom appearance controls, named themes and the temporary `?theme-editor=1` preview are removed. For a compiled publication, change published branding through the validated `theme` section in the project's YAML or JSON configuration and rebuild. Existing custom visitor settings are discarded while recognized mode, layout and preset choices migrate.

See [workspace layout and fullscreen responses](reader-layout.md) for responsive islands, visitor width preferences, keyboard resizing and response viewing.
