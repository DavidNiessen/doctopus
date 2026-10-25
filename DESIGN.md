---
name: Doctopus
description: A flat, precise interface for reading API documentation and operating documentation workspaces.
colors:
  mint: '#07c983'
  ocean: '#2563eb'
  violet: '#7c3aed'
  neutral-accent: '#526071'
  action: '#087a50'
  action-hover: 'color-mix(in srgb, var(--action-bg) 88%, #000)'
  light-background: '#ffffff'
  light-surface: '#f8faf9'
  light-subtle: '#f0f4f2'
  light-border: '#e5e9e7'
  light-text: '#3f4945'
  light-muted: '#626e68'
  light-heading: '#17211c'
  dark-background: '#090d0d'
  dark-surface: '#171b19'
  dark-subtle: '#0d1712'
  dark-border: '#262a27'
  dark-text: '#ced3d0'
  dark-muted: '#9fa3a0'
  dark-reader-heading: '#dfe3e0'
  dark-studio-heading: '#f8faf9'
  light-accent-surface: '#eaf8f0'
  dark-accent-surface: '#0b261b'
  light-success-surface: '#eaf7ef'
  light-success-text: '#12654c'
  dark-success-surface: '#1e332b'
  dark-success-text: '#95e1bc'
  light-error-surface: '#fff0ee'
  light-error-text: '#a23c31'
  dark-error-surface: '#3b2429'
  dark-error-text: '#ffb4b4'
  light-warning-surface: '#fffcf0'
  light-warning-text: '#80591a'
  dark-warning-surface: '#332b1d'
  dark-warning-text: '#f2ce80'
  light-info-surface: '#eaf1ff'
  light-info-text: '#244b85'
  dark-info-surface: '#1e2b43'
  dark-info-text: '#9dc2ff'
  light-get-text: '#087444'
  light-get-surface: '#e4f8ed'
  dark-get-text: '#61d79b'
  dark-get-surface: '#123426'
  light-post-text: '#225fbb'
  light-post-surface: '#eaf2ff'
  dark-post-text: '#6db3ff'
  dark-post-surface: '#142f43'
  field-border: 'color-mix(in srgb, var(--muted) 55%, var(--bg))'
  reader-active-surface: 'color-mix(in srgb, var(--accent) 9%, var(--bg))'
typography:
  endpoint-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: '2.25rem'
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: '-0.035em'
  workspace-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: '2rem'
    lineHeight: 1.2
    letterSpacing: '-0.03em'
  section-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: '1.125rem'
    fontWeight: 600
    letterSpacing: '-0.015em'
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: '1rem'
    lineHeight: 1.75
  lead:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: '1.125rem'
    lineHeight: 1.6
  interface:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: '0.875rem'
  small:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: '0.8125rem'
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: '0.75rem'
  code:
    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace"
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.8
rounded:
  badge: '4px'
  state-badge: '5px'
  compact-control: '6px'
  control: '8px'
  privacy-notice: '10px'
  navigation: '12px'
  panel: '14px'
  example: '16px'
  settings: '22px'
  playground: '24px'
spacing:
  xs: '4px'
  sm: '8px'
  control: '12px'
  md: '16px'
  form: '20px'
  lg: '24px'
  xl: '28px'
  workspace: '32px'
  section-mobile: '40px'
  column-gap: '48px'
  section: '60px'
components:
  button-primary:
    backgroundColor: '{colors.action}'
    textColor: '{colors.light-background}'
    typography: '{typography.interface}'
    rounded: '{rounded.control}'
    padding: '8px 14px'
    height: '36px'
  button-primary-hover:
    backgroundColor: '{colors.action-hover}'
  button-secondary:
    backgroundColor: '{colors.light-background}'
    textColor: '{colors.light-text}'
    typography: '{typography.interface}'
    rounded: '{rounded.control}'
    padding: '8px 14px'
    height: '36px'
  field:
    backgroundColor: '{colors.light-background}'
    textColor: '{colors.light-text}'
    typography: '{typography.interface}'
    rounded: '{rounded.control}'
    padding: '8px 10px'
    height: '36px'
  navigation-item:
    typography: '{typography.interface}'
    rounded: '{rounded.navigation}'
    padding: '8px 16px'
  method-get:
    backgroundColor: '{colors.light-get-surface}'
    textColor: '{colors.light-get-text}'
    rounded: '{rounded.compact-control}'
    padding: '0 8px'
    height: '24px'
    width: '44px'
  code-example:
    backgroundColor: '{colors.light-surface}'
    textColor: '{colors.light-text}'
    typography: '{typography.code}'
    rounded: '{rounded.example}'
  studio-panel:
    backgroundColor: '{colors.light-background}'
    rounded: '{rounded.panel}'
    padding: '24px'
---

# Design System: Doctopus

## Overview

**Creative North Star: "Familiar, precise documentation software"** guides the reader and operational workspace.

Doctopus uses a centered, flat documentation canvas and a practical operating workspace. Typography, quiet dividers and restrained surface changes organize the interface. The violet octopus assets retain the product identity while the default reference uses mint accents; published branding and the prepared alternate palettes remain supported.

Documentation prioritizes reading and understanding. The playground and Studio prioritize completing real tasks, with labeled forms, meaningful tables and explicit states. This is the Doctopus project system: its documented patterns describe the implemented reader and Studio rather than a universal interface template.

**Key Characteristics:**

- Centered documentation shell with an unboxed article.
- Shared local typefaces, palette roles and native controls.
- Separate request/response examples and adjustable workspace tracks.
- Flat surfaces with depth reserved for overlays.

## Colors

The palette uses quiet green-tinted neutrals, restrained mint emphasis and separate semantic state colors. Frontmatter records the shipped defaults; published configuration can override reader palette roles.

### Primary

Mint is the default reference accent. Ocean, violet and neutral are prepared reader presets. Studio uses the action role for filled primary actions and an appearance-specific accent text role; the reader derives these roles from its configured accent. The request send/try action uses ocean with its darker hover treatment.

### Secondary

The existing violet octopus remains the product identity asset. It does not force every interactive control to use violet.

### Neutral

Background is the canvas; surface and subtle group examples and supporting controls; border divides regions. Text, muted and heading remain distinct roles. Reader and Studio share the default neutrals, with the recorded dark heading difference retained.

### Semantic states

Studio pairs success, error, warning and information text with matching tinted surfaces. Builds distinguish queued/running, succeeded, failed and cancelled states. Reader success/error and syntax text are resolved with `readableAccent`; comments use the resolved muted role. GET and POST badges have explicit light/dark pairs.

**The Resolved Palette Rule.** Use the resolved palette for body text, inputs, tables and examples. Derive accent and syntax text against the actual background and surface rather than using raw brand colors as text.

`packages/contracts/src/theme.ts` owns reader defaults and preset accents. `readableAccent` checks the configured background, surface and an 8% accent tint, choosing a text color that reaches a contrast ratio of at least 5 when possible. Syntax seed hues are transformed by this function, not final fixed theme colors. Studio's semantic role pairs live in its base stylesheet.

## Typography

Inter is the heading, body, form and navigation face. JetBrains Mono is the code and data face. Both are locally bundled Latin variable subsets under the SIL Open Font License; their fallbacks and observed role values are recorded in frontmatter. Font weights available in the files span 100–900 for Inter and 100–800 for JetBrains Mono.

Endpoint titles establish the reading hierarchy; section titles stay compact. Guide prose uses the body role and a maximum paragraph/list/blockquote measure of 72ch inside the configurable content width. Interface text uses the shared interface, small and label sizes. Studio explanatory paragraphs use 0.9375rem with a 1.8 line height; code examples use the compact code role, while Studio build editors use 0.8125rem/1.7 monospace. Tables use tabular numerals.

Use rem-based text sizing. At the reader mobile breakpoint endpoint titles become 1.875rem and descriptions become 1rem; Studio titles become 1.75rem at its mobile breakpoint. Text inputs, selects and textareas use at least 1rem on narrow screens to preserve readable native editing.

## Layout

The modern reader centers a maximum 1408px shell. Its two-row header totals 112px: a 64px main row and a 47px tab row above the divider. The desktop grid uses a default 288px navigation track, a 12px resize track and the main region. Main content begins 40px below the header with 32px left inset. Navigation adjusts from 220–380px.

API content has an unboxed article, a 48px middle track and a default 448px example track constrained by `minmax(260px, min(var(--api-panel-width, 448px), 44%))`. Example resizing allows 260–560px. Guide content defaults to a 760px content width, alongside a default 192px contents track adjustable from 160–340px. Examples and contents are sticky below the header. API sections use the section spacing token; mobile sections use section-mobile.

Reader responsive behavior comes from the final workspace stylesheet:

- Between 761px and 1280px, API examples and guide contents move to a single main column; inspector resize handles disappear and examples stop sticking.
- Between 761px and 1023px, the navigation track is 220px and main padding is 32px 24px 48px.
- At 760px and below, the shell becomes one column, the header is 108px, navigation is a drawer no wider than `min(320px, calc(100vw - 24px))`, and main padding is 28px 24px 48px. Resize handles disappear. Playground request and response regions stack; response output is bounded by `min(720px, 80dvh)` with a 320px minimum.
- Settings use a two-column control grid until 520px, then one column. The native settings dialog is at most 560px wide, with viewport margins and local vertical scrolling.

Studio uses a flat header with a measured CSS height, a default 240px rail adjustable from 200–360px, a 12px resize track, and a main region no wider than 1200px. Desktop main padding is `44px clamp(28px, 4vw, 64px) 40px 32px`. At 1000px and below the heading stacks and main padding becomes 32px 24px. At 620px and below, navigation becomes a horizontally scrollable row, the rail resize controls disappear, forms and metrics stack, and main padding becomes 28px 20px. Build controls stack at 600px.

Studio tables retain a minimum 720px table inside a labeled, focusable local scroll region, including mobile layouts. Do not cause page-wide overflow. Shared control height is 36px, becoming 44px at 760px and below or for a coarse pointer; compact example-toolbar controls have their own observed sizing. Preserve those component-specific rules rather than treating every small toolbar as a full form row.

Classic endpoint rows align descriptions in a common grid column. Each endpoint header retains the same keyboard-accessible Try now button in both disclosure states, with explicit loading and retry states; the button is outside the native summary.

Classic reference remains an alternate layout: a maximum 1600px shell, navigation `min(250px, 26vw)`, no resize controls, examples below the article, and hidden contents rail. Its mobile main padding is 24px 16px.

## Elevation & Depth

The reader shell, header, navigation, main article and Studio workspace are flat. Fine borders and tonal surfaces establish hierarchy. Native dialogs, the mobile navigation drawer and floating menus use shadows and dimmed backdrops where their actual overlay behavior needs separation. Shared chrome uses a small shadow token; it is not a reason to add raised cards to content.

**The Content Before Containers Rule.** Keep the reading article and workspace shell flat. Use borders and surfaces to group actual controls, examples, data and focused tasks.

Exact overlay and focus shadows are retained in the sidecar. Focus uses visible accent outlines and, for fields, a restrained accent ring. Increased contrast replaces shared border roles with muted text color, removes the shared shadow and makes chrome opaque. Reduced motion removes animation, transitions and smooth scrolling.

## Shapes

Controls use the shared control radius; navigation uses the navigation radius. Code and response examples use the example radius with a thin border and quiet toolbar. Studio panels use the panel radius; table scroll frames use the navigation radius. Compact metadata badges stay modestly rounded rather than becoming oversized pills. Settings and playground dialogs have their own larger radii.

Borders are generally one pixel. The reading article and workspace rails have no enclosing rounded box. Do not generalize the dialog silhouette to ordinary content. Native scrollbars remain thin, with hover/focus emphasis and platform colors under forced colors.

## Components

### Buttons

Primary actions pair the action background with white text; hover darkens the same role. Secondary buttons use the background, text and border roles and hover to surface. Studio primary/secondary padding and minimum height are recorded in frontmatter; use minimum height rather than a fixed height when text wraps. Buttons expose disabled state and retain a visible focus outline. Active buttons apply the shipped brightness treatment.

The endpoint address bar follows the published corner radius, with a 1px border and 6px padding. Its Try now action stretches to the available control height and derives its corners from the outer radius minus that inset and border, clamped at zero. This keeps the corners concentric on compact and wide screens.

### Inputs / Fields

Inputs, selects and textareas use resolved background/text, a field-border role and the shared control radius. Credential prefixes and inputs form one bordered control with a shared focus ring; the input does not draw a second inner ring. Focus changes the border and adds an accent outline/ring. The search field uses 8px vertical and 12px horizontal padding so the caret and placeholder sit inside the focus boundary. Search result icon columns accommodate full method names without shrinking. Request forms group labels, descriptions, type metadata, required state and controls in real sections; advanced controls use native disclosure. Studio forms use consistent label spacing and stacked mobile columns. Preserve error, permission and disabled states rather than relying on color alone.

Custom request fields align their key and value controls at the top of the row. Key inputs share value-input padding; type metadata underneath the key does not vertically shift the value or its actions. Compact layouts retain stacked controls and touch sizing.

### Navigation

Reader links use compact method badges and a restrained accent tint for the active endpoint. Top-level reader tabs are underlined. Modern mode orders All, API Reference, Documentation; classic mode orders API Reference, Documentation and omits All. Classic mode selects API Reference at the site root; explicit guide links select Documentation. Modern mode defaults to All. Studio navigation uses the same font and rounded selection rhythm. Mobile reader navigation is a drawer; mobile Studio navigation scrolls horizontally. Keep current-item semantics and visible keyboard focus.

Resize handles are keyboard-focusable separators with labels and current/minimum/maximum values. Arrow keys adjust widths; Shift increases the step; Home/End choose bounds; double-click restores the initial width. Width persistence is optional when browser storage is unavailable.

### Chips / Metadata

HTTP methods carry semantic color pairs. Their shared badge uses the same local monospace face as endpoint paths with 0.75rem text, a 1.5rem minimum height, a 2.75rem minimum width and 0.375rem corners. Sidebar rows retain their navigation height without shrinking the badge text; longer method names expand the badge rather than clipping. Type and required badges remain compact metadata beside the actual field label. Studio publication/build badges describe real state using the corresponding semantic role; cancelled builds use neutral roles.

### Code / Response Examples

Request and response examples sit in their own bordered surfaces. Toolbars provide actual language, status, media or example selection when the contract supports them. Syntax colors follow the resolved reader palette; copying preserves original source text. Response output retains folding, native scrolling and fullscreen controls. Keep code overflow inside the example rather than widening the article.

### Tables / Operational Panels

Studio panels group meaningful forms and data with a border and padding. Tables use clear headers, quiet row dividers, tabular numerals and row hover. Preserve the local scroll surface, labeled region and keyboard focus on narrow screens. Metrics are divided flat rows/columns; they are not decorative chart cards.

### Dialogs / Settings

Use native dialogs for focused settings, playground and fullscreen tasks. Settings presents its title directly, followed by appearance controls and storage status. System/light/dark modes, published or prepared presets and modern/classic layout choices remain available. Preserve Escape/dismissal, focus restoration, localized labels and viewport scrolling.

## Do's and Don'ts

### Do

- **Do** preserve Doctopus naming and the violet octopus identity assets.
- **Do** apply published or prepared palette roles consistently to text, controls, tables and code.
- **Do** keep labels, descriptions, required/type metadata and explicit operational states visible where they are needed.
- **Do** preserve keyboard and pointer resizing, native dialog behavior, clipboard fidelity, folding and fullscreen behavior.
- **Do** keep table overflow local, focusable and labeled, and preserve localization and text zoom.

### Don't

- **Don't** wrap the main reading article in a decorative card.
- **Don't** add decorative kickers to the settings heading or promote leftover eyebrow selectors into a reusable pattern.
- **Don't** replace meaningful tables with narrow mobile cards or hide columns to fit the viewport.
- **Don't** add nonfunctional assistant controls, decorative dashboard charts or invented product claims.
- **Don't** introduce font CDN or icon runtime requests.

Page navigation retains the current page for quick fetches and displays an inline, theme-aware skeleton after 250ms. It uses a busy main region with a localized loading status, without a fixed loading toast. Request URLs are read-only and retain full-copy support. Body editing exposes Form and JSON; schema controls remain available within Form.
