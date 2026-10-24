# Documentation workspace design

This redesign applies the [Apple Design skill](https://github.com/dickwu/apple-design-skill/blob/914b6a377c22755597e4405e54911b996de822d7/SKILL.md) to the React reader and Studio. Its HIG references inform web accessibility and design principles; this is not a native Apple app, a Liquid Glass implementation or a claim of independent accessibility approval. Reader appearance/layout controls remain available as explicitly requested, including preset themes and matching response-editor colors.

## Review and direction

Baseline rating: **Needs work**. The reading and request flows are capable, but several readability, control-comfort and appearance-preference issues merit the changes below. This is a design assessment of source and browser screenshots, not an independent production accessibility certification.

The product's job is to help an API consumer understand an endpoint and confidently inspect one request and response. The signature is a quiet reading workspace that opens into a precise request workbench: the destination/action bar, editable inputs and read-only response have distinct roles. It preserves the existing resizable islands, native dialogs, prepared themes, classic endpoint list, offline search and static hosting.

The baseline screenshots show several improvements worth making, rather than a new navigation model:

- **High:** mobile toolbar icons use 30px targets. Increase these to 44px and desktop targets to 36px. `accessibility.md › Mobility`: “Offer sufficiently sized controls.” Native Apple point sizes are design guidance here; browser CSS pixels and measured web hit regions are tested separately.
- **Medium:** many controls and secondary data use 9–12px text, while guide paragraphs use 14px and shrink further on compact screens. Establish a rem-based scale, retaining legible hierarchy at larger text sizes. `typography.md › Ensuring legibility`: “Use font sizes that most people can read easily.”
- **Medium:** repeated nested borders and promotional accessories compete with documentation. Keep the content opaque, group related controls, and remove the decorative developer-status line and repeated TOC promotion. `layout.md › Visual hierarchy`: “Group related items to clearly express related information or functions.” The assessment of excess decoration is design judgment.
- **High:** custom translucency has no explicit reduced-transparency treatment, and Studio is fixed to a light palette. Add opaque fallbacks, increased-contrast/forced-color treatment and system dark appearance for Studio. `color.md › Best practices`: “Make sure all your app’s colors work well in light, dark, and increased contrast contexts.”

What works: the request URL exposes the destination before sending; the playground has a native modal/focus lifecycle; response folding, complete copy and fullscreen already work; native selects keep preferences accessible; and classic mode provides a distinct endpoint-list workflow. Preserve these behaviors.

## Tokens and layout

Default semantic palette, with project-authored palette overrides and prepared accent choices preserved:

| Role               | Light     | Dark      |
| ------------------ | --------- | --------- |
| Content surface    | `#ffffff` | `#18181b` |
| Grouped surface    | `#f5f5f7` | `#202024` |
| Body text          | `#343438` | `#dedee4` |
| Secondary text     | `#61616b` | `#aaaab4` |
| Heading            | `#1d1d20` | `#f5f5f7` |
| Studio accent text | `#13765d` | `#89dfbf` |

Body/secondary/heading contrast against the content surface is **12.39:1 / 6.12:1 / 16.82:1** in light appearance and **13.22:1 / 7.69:1 / 16.27:1** in dark appearance. Studio accent text is **5.56:1 / 11.28:1**. These figures are computed from the listed hex values. Reader accent text continues to use the existing contrast-aware palette resolver. Studio's primary filled action uses the dark green with white text in either appearance. Colors identify semantic roles rather than imitating a system color API.

Use the system UI family for controls and content, retaining configured font families, and a system monospace stack for URLs/code. The scale is 12px metadata, 13px compact data, 14px controls, 16px reading text, 17px lead text and 30–40px page titles at the default root size. Values use rem units so browser text-size preferences can enlarge them. Compact editable inputs use at least 16px. Spacing follows a 4px base, with 12px island gutters, 24–48px content padding and 18–22px modern surface radii. Classic mode retains its simpler list geometry.

Regular and compact layouts follow available width:

```text
Regular
┌ Brand · Search                     Links · Preferences ┐
│ All / Documentation / API Reference                    │
└───────────────────────────────────────────────────────┘
┌ Navigation ┐  ┌ Reading surface       ┐  ┌ Contents   ┐
│            │↔ │ Title / guide or API  │↔ │ or request │
└────────────┘  └───────────────────────┘  └────────────┘

Compact                         Request workbench
┌ Brand · Search · Menu ┐        ┌ Method · URL · Send · Close ┐
│ Navigation filters    │        ├ Request inputs ┬ Response   ┤
├ Reading surface       ┤        │               │ Code view  │
│ Inline API preview    │        └───────────────┴────────────┘
└───────────────────────┘        Stack panels at compact widths
```

The plan deliberately retains API terminology, code-oriented data, authored branding and a substantive request workbench. A generic frosted dashboard would obscure this product's purpose. The boldness belongs in the destination/action bar; reading content remains quiet. This is design judgment.

## Interaction and verification

Limit blur to the floating navigation and modal backdrop; content cards remain opaque. `liquid-glass.md › Where the material belongs`: “Don't use Liquid Glass in the content layer.” CSS blur is a limited web approximation, with opaque defaults/fallbacks. Respect reduced transparency, reduced motion, increased contrast and forced colors. Dialogs appear immediately so focused content remains fully readable throughout opening. Appearance changes update foreground and background together; no decorative page animations or bouncing controls.

Keep native dialog dismissal, focus restoration, keyboard resizing, full response copying, read-only Monaco, selected theme matching and search shortcuts. Validate guide, endpoint, settings, search, playground, response fullscreen, classic mode and Studio; inspect light/dark at 360, 768, 1280 and 1920px plus enlarged text. Automated browser/axe checks and visual inspection remain distinct from deferred independent accessibility and pilot reviews.

## Implementation review

The reader now uses a centered reading column, a segmented navigation filter, a quieter contents rail and grouped native preference controls. Studio shares the same type/control scale and semantic light/dark surfaces. Text symbols in its navigation and brand mark have been replaced with original inline SVGs; the marks stay contained when text is doubled. Content stays opaque and the request URL remains a distinct action surface. These are design judgments applied within the existing product structure.

Local verification on 2026-10-24:

- Production builds, TypeScript, ESLint, Markdown lint and Prettier pass. All 42 targeted content, preference, translation and editor-theme unit tests pass.
- All 11 Chromium static-demo checks pass, including existing complete response copy, folding, fullscreen, mock-only execution, classic reference, offline search and no-JavaScript reading journeys. New coverage exercises light/dark at 360, 768, 1280 and 1920px, doubled compact text, visible keyboard focus, contrast/motion preferences and forced colors.
- Local Studio appearance previews pass axe and doubled-text reflow in both appearances at 360px. These previews mock session data for visual inspection; the real publication/authentication journeys remain in hosted Studio CI. Chromium CDP emulation separately confirms the reader's reduced-transparency fallback.
- Ten cold mobile samples per guide/endpoint route pass the existing browser budgets: p95 LCP **1,172 / 1,088ms**, maximum CLS **0 / 0**, and p95 scripted search-open latency **132 / 115ms**. Initial JavaScript is **139,011 gzip bytes**; Monaco remains deferred. Profile: 390×844, 4× CPU slowdown, 150ms latency and 1.6Mb/s download. These are shared-host lab observations, not field INP or a before/after speed comparison. The report recorded source `ebafcef` with the working tree dirty because Studio mark polish was in progress; the tested reader artifact digest is `e104778ab0b9b84928ecc14976ec386893bdb764978eabbb77b121ec1061a841`.

The review found and corrected five issues: prefixed CSS declaration ordering defeated the opaque-header fallback in the production bundle, text-based Studio marks escaped fixed containers at doubled text, the contrast helper retained obsolete default surfaces, and longer fallback-font headings overflowed reader and Studio compact content at doubled text. Prose now wraps long words instead of hiding overflow. Hosted axe checks also exposed transient low contrast during button color transitions and dialog fades; removing those effects keeps opening dialogs and appearance changes readable at every frame. The existing contrast regression now checks resolved background/surface roles in both appearances. Native dialog semantics, response-editor behavior and navigation structure remain intact. Independent accessibility, linguistic, real-device and pilot reviews remain separate and deferred; automated checks do not establish certification.

This source redesign changes the next build and the master-branch demo. It does not replace or modify the immutable `0.2.0-candidate.7` registry artifacts or their historical release evidence. Hosted acceptance is tracked by [PR 19](https://github.com/DavidNiessen/doctopus/pull/19) and its linked workflow runs.
