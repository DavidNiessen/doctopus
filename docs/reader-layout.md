# Workspace layout and fullscreen responses

The reader uses a centered, flat documentation canvas with a two-row header, an adjustable navigation rail, and an unboxed article. API pages place request and response example cards beside the article when space permits. Code cards and functional form groups use 12–16px corners. Existing project colors, light/dark palettes, density and branding remain configurable.

The reader and Studio share locally hosted Inter for interface text and JetBrains Mono for code, semantic surfaces and control sizing. Guide text starts at 16px, desktop toolbar targets at 36px, and compact/touch controls at 44px. Text uses relative units and reflows with enlarged browser text. Headers use opaque surfaces; increased contrast and reduced transparency make them opaque, reduced motion disables transitions, and forced colors preserve system borders and focus indicators. Studio follows system light/dark appearance. See the [design review and verification](design/workspace.md).

## Personal reader settings

Open the settings button in the header to customize this browser's reading experience. Settings apply to the current origin and documentation base path, independently of published project configuration. They survive reloads and synchronize with other open tabs for the same site. No account, request contents, response data or API credentials are stored with appearance preferences. Blocked storage keeps settings usable for the current visit; invalid, unsupported or oversized saved data falls back to safe defaults.

Choose system, light or dark appearance. System mode follows operating-system changes while the site is open. Choose the published theme or one of four prepared presets: **Mint**, **Ocean**, **Violet** and **Neutral**. Presets replace personal reading colors while retaining the project's typography, density and sizing. **Use published theme** restores the project's palette. Reader settings contain no custom color, saved-theme or editor-theme controls. Project authors can still configure branding in YAML or JSON; see [customization](customization.md).

Older saved settings migrate valid appearance, layout and preset choices. Custom palettes, named themes and independent editor-theme overrides are discarded. After the current settings are saved successfully, the old storage entry is removed.

The default **Modern documentation** layout keeps resizable navigation and inspectors. Choose **Reader settings → Documentation layout → Classic API reference** for a collapsed endpoint list. **Classic API reference** shows collapsed, method-colored endpoint rows grouped by tag in the main page, with no API sidebar. Expand a row to read its description, parameters, schemas and responses, or open **Try now**. One row expands at a time. Its API/version selector sits above the list. Guides retain their navigation rail, and switching back restores modern sizing preferences. Both layouts retain search and the modal API playground.

Classic lists use complete exported endpoint catalogs, with 100 rows per page, independently of the bounded sidebar inventory. Full schema/security details load only when needed. Paging, collapsing, changing API/version or leaving the layout cancels obsolete metadata work; late results cannot replace the selected endpoint. Loading failures offer explicit retry controls. Catalog and detail requests have byte/deadline limits. An endpoint permalink or shared playground URL uses a `#classic-<page>-<slug>` fragment to restore the selected row; a plain reference page initially keeps every row collapsed. The existing read-only response editor, fullscreen/copy behavior and authentication policies apply to classic playgrounds.

The response editor automatically follows the selected reader theme and resolved light/dark appearance, including system changes. Its background, text, gutter and scrollbars match the reader palette; highlighted property keys follow the accent, with readable colors for strings, numbers and keywords. Theme changes, including from another tab, preserve the response and folding state. Fullscreen uses the same colors, and copying returns the entire original response.

Reader and Studio scrollbars use slim, theme-aware thumbs and transparent tracks, with stronger hover/focus colors. Native scrolling retains keyboard and touch behavior. Forced-color mode restores platform scrollbar colors, and Monaco uses its own matching compact scrollbar controls.

## Filter sidebar navigation

**All** is the initial section on every page load and shows authored guides alongside endpoints for the selected API version. **Documentation** shows guide groups only; **API Reference** shows endpoint groups and the API version selector. Selecting a section opens its first page when crossing from the other section. Ordinary sidebar links and back/forward navigation keep an active section consistent with the displayed page; All continues including both kinds. Search remains available across the documentation. Pre-rendered navigation includes both kinds for readers without JavaScript.

## Resize the workspace

On desktop, drag the gutter between navigation and content or between the article and inspector. The playground also has a divider between request configuration and response. Width changes update CSS tracks without rerendering the documentation tree or sending API requests. Preferred widths are bounded, and available space can further constrain rendered widths.

Each divider is keyboard focusable and announces its preferred width:

- Left/right arrows move the divider by 16 pixels.
- Hold Shift for 32-pixel changes.
- Home/End select the minimum/maximum preferred width.
- Double-click restores the default width.

Navigation defaults to the configured `theme.sidebarWidth`. API and guide inspectors have separate preferences. Preferences are local to the browser origin and project base path; the playground shares its project preference across endpoints. Storage failure uses working in-memory defaults. No credentials or response data are stored with these preferences. Clear the site's browser storage to remove saved preferences.

Medium layouts stack API examples beneath the article. Compact layouts use the existing navigation menu and stack the playground's request and response panels. Unneeded dividers disappear rather than reserving width. Pre-rendered content and ordinary links remain usable without JavaScript; interactive resizing becomes available after hydration.

Studio uses the same flat canvas, navigation states and typography, with borders grouping operational forms and tables. Its header offers System, Light and Dark appearance, remembered for the current browser and synchronized across tabs. System appearance follows operating-system changes; blocked storage keeps controls usable for the current visit. Drag the divider beside its desktop navigation to resize it, or focus the divider and use Left/Right (Shift for larger steps), Home/End or double-click to reset. It remembers the preferred width locally, including widths saved by the former slider. On compact screens, navigation becomes a horizontal menu and the resize divider is hidden.

## Response pane

The playground's response editor fills its pane without an inset card or fixed editor height. The empty state fills the same area before a response arrives. Status and expandable response headers remain available, and Monaco owns code scrolling. On compact screens, the stacked response pane has its own bounded height. Mock response options are grouped with the request inputs on the left rather than above the response editor.

## View an entire response

After receiving or generating a response, choose **View response fullscreen** in the response-editor toolbar. A native modal expands the response view to the viewport, with read-only Monaco highlighting, folding, scrolling and **Copy entire response**. Switching views preserves folding/scroll state for the same response. Copy retains the complete original response text, including formatting and precise number tokens; the formatted display does not replace the copy source.

Use **Exit response fullscreen** or Escape to return to the existing playground. Focus returns to the fullscreen button, and another Escape closes the playground. This is a viewport-sized application modal; it does not request browser fullscreen permissions or hide browser chrome. The same controls work on mobile and in both themes. An editor-initialization failure retains a plain response view and copy action; failure to load the editor module retains the existing plain fallback.

Fullscreen changes presentation only. Existing explorer transport, response limits, authentication and cancellation policies continue to apply. See [request serialization](request-serialization.md) and [explorer authentication](explorer-auth.md) for those contracts.
