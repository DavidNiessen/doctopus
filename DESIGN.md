# Doctopus design system

## Visual authority

Follow the owner's Mintlify reference across the reader, playground, search, preferences, classic reference and Studio. This replaces the former floating-island shell. Doctopus remains the product name and keeps its octopus assets.

Impeccable guidance is applied in **Read** mode for documentation and **Operate** mode for the playground and Studio. The target is familiar, precise documentation software, with restrained surfaces and working controls. No decorative dashboard charts, invented product claims or nonfunctional assistant controls.

## Type and color

- Locally hosted Inter for headings, navigation, forms and body copy; JetBrains Mono for code and data.
- Body copy 14–16 px, endpoint titles 36 px, interface labels 12–14 px. Use rem units and preserve text zoom.
- White light canvas; dark canvas `#090d0d`, secondary surface `#171b19`, border `#262a27`.
- Mint accent for the reference/default demo. Published branding and prepared alternate presets remain available.
- Use semantic text, muted, action, success, warning and error roles. Validate contrast in every appearance.

## Reader

- Center the desktop shell in a 1408 px measure. Use a quiet, full-width two-row header with a subtle divider and underlined section tabs.
- Keep the navigation rail flat, approximately 288 px wide. Active items use a restrained accent tint; method badges are compact and carry standard HTTP method colors.
- API pages have an unboxed reading column and a 448 px request/response example column, with approximately 48 px between them. Preserve resizable tracks.
- Use generous space between API sections, fine dividers between schema properties, compact type/required badges and inline media labels.
- Code cards have a 12–16 px radius, one thin border, a quiet toolbar and syntax colors. Copy always preserves the original text.
- Guides retain a readable measure, a quiet contents rail and coherent authored components.

## Operate surfaces

- Forms use labels, descriptions, type/required metadata and inputs with consistent spacing. Advanced options use progressive disclosure.
- Studio uses the same typography, palette, navigation states and controls. Its workspace is flat; borders group real forms, data tables and operational sections.
- Tables use tabular numerals, clear headings, subtle row dividers and accessible overflow. Empty, loading, error, success and permission states stay explicit.
- Dialogs protect focused tasks and keep native keyboard and dismissal behavior. Avoid oversized decoration and unnecessary nested panels.

## Responsive behavior and craft

Collapse navigation and multi-column layouts at appropriate breakpoints. Controls remain usable at 360 px, with larger touch targets and stacked forms. Test intermediate widths, wide screens, doubled text, reduced motion, increased contrast and keyboard navigation.

Use the reference for visual iteration, then verify real flows with all three browser engines. Keep fonts and icons local; do not introduce third-party runtime requests.
