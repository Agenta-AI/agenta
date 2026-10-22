# Design

## Context

See proposal.md for the motivation. The facts below were checked in the code on 2026-10-23.
Paths are relative to `web/packages/`.

- **Quote store.** `agenta-shared/src/quotes.ts` defines `Quote` and
  `QuoteSource = MessageQuoteSource | FileQuoteSource`, and `quotesToMarkdown` /
  `splitQuotedMessage` (regex `QUOTE_HEAD`) write and parse the quote blocks the agent
  receives. `agenta-ui/src/QuoteSelection/store.ts` keeps quotes per session in memory with
  `addQuote`, `updateQuote`, `removeQuote`, `clearQuotes` and `restoreQuotes`. `QuoteNote`
  needs only an anchor rectangle and the pane bounds.
- **HTML apps.** `DriveExplorer.tsx` runs every `.html` file in the Files pane through
  `DriveHtmlApp`. The app runs in a sandboxed iframe (`allow-scripts allow-forms`) nested in a
  wrapper iframe (`agenta-entities/src/drive/htmlApp/frame.ts`). Host and app talk only over a
  `MessagePort` that `createHtmlAppHost` (`host.ts`) hands to the injected stub (`stub.ts`).
  The stub is a self-contained ES2017 function shipped as a string by `buildBridgeStub()`,
  inlined ahead of the app's scripts, and unit-tested in jsdom.
- **Office viewer** (lane `feat/office-files-preview`). `agenta-entity-ui/src/drive/officeViewer/`
  renders DOCX with `docx-preview` and PPTX with `@aiden0z/pptx-renderer` 1.4.0 in an iframe
  with `allow-scripts` and a CSP that blocks all network access. Its outer relay forwards
  every message both ways. `frame/runtime.ts` is bundled into `generated/*.ts` by
  `scripts/build-office-viewers.mjs` (esbuild, IIFE). `OfficeViewerFrame.tsx` listens for
  messages from the iframe and sends `render` and `goto`.
- **DOCX DOM.** Pages are `section.docx` elements with normal paragraph and table elements.
  `fitPages` sets CSS `zoom` on the wrapper. In Chrome 152, `getBoundingClientRect()` on a
  child of a `zoom: 0.5` element returns the zoomed size, so no manual zoom correction is
  needed.
- **PPTX DOM.** In slide mode the slide root is `container.firstElementChild.firstElementChild`.
  The renderer appends one element per shape, picture, table, chart or group, from the
  master, the layout and the slide, as direct children of that root. It writes no shape name
  or id to the DOM. The only shape-level marker is `data-pptx-shape-background`.
- **Spreadsheets.** `workbook.ts` builds `Sheet.rows` starting at the start of the sheet's
  `!ref` range and drops that origin. `PreviewTable` renders the rows in the host page, with
  the first row as the header.
- **Files pane layout.** `DriveExplorer` renders `DriveToolbar` (`variant="other"`) for both
  HTML apps and previews, and renders either `DriveHtmlApp` or `DriveFilePreview` below it.
  `DriveFilePreview` renders `DriveFileContentViewer`, which reaches `SpreadsheetBody` and
  `OfficeFrameBody` through `DriveFileBody`. `useDriveSessionId()` gives the conversation's
  session id, or null outside a conversation.
- **Package layers.** `shared ← ui ← entities ← entity-ui / chat`. Cross-package imports use
  exported subpaths only.

## Goals / Non-Goals

**Goals:**
- One picker implementation for the two iframe bridges.
- No new state system: comments are quotes.
- The host page draws every piece of comment UI; the iframe only reports facts.

**Non-Goals:**
- Comment mode in the chat media viewer. Files pane only.
- CSV previews, PDF, images, drawing, screenshots, server-side storage, threads.
- Fuzzy re-anchoring. A comment is found by selector or by exact text, or it is stale.

## Decisions

### D1. A comment is a quote with a third source kind

Add `PreviewQuoteSource` to `QuoteSource`:

```ts
interface PreviewQuoteSource {
    kind: "preview"
    path: string
    displayPath: string
    fileName: string
    mountId?: string
    anchor: ElementAnchor | CellAnchor
}
interface ElementAnchor {
    type: "element"
    format: "html" | "document" | "presentation"
    selector: string     // search hint inside the rendered document
    tag: string
    page?: number        // DOCX page or PPTX slide, 1-based
    openTag?: string     // HTML only, capped at 300 characters
    point: {x: number; y: number}  // 0..1 inside the element; places the pin
}
interface CellAnchor {
    type: "cells"
    sheet: string
    range: string        // A1, in sheet coordinates
}
```

`Quote.text` holds the element's tidied visible text, or the cell table. `note`, `staged` and
`stale` keep their meaning. `refreshFileQuote` already returns null for non-file sources, so
line-range freshness skips these quotes without a change.

Alternative: a separate comment store. Rejected because it would duplicate staging, chips,
send, restore and the sent-message parse-back.

### D2. One picker module in `@agenta/shared`

`agenta-shared/src/previewPicker.ts`, exported as `@agenta/shared/previewPicker`, holds
`installPreviewPicker(post)`, written under the stub's rules (one self-contained ES2017
function, no imports, no spread, no optional chaining). It returns `handle(message)`.

- The HTML stub receives it as an argument: `buildBridgeStub()` emits
  `(${bridgeStub})(${installPreviewPicker})`. The stub calls it with a `post` that writes to
  its port, and routes `pick-start`, `pick-stop` and `pins` from the port to `handle`.
- The office frame imports it in `frame/runtime.ts`; esbuild bundles it into the viewer
  scripts. `post` is `window.parent.postMessage(message, "*")`.

`@agenta/shared` is the only package both `agenta-entities` (stub) and `agenta-entity-ui`
(office frame) may import, and its subpath import keeps the esbuild bundle free of other
modules.

Alternative: two pickers, one per bridge. Rejected: the element rules, selector, text capture
and position reporting would be written twice.

### D3. Picker behavior

- Listeners on `window` in the capture phase. They run before the app's handlers (the stub and
  the picker install before the app's scripts) and before the office runtime's link handler
  (registered on `document`). In comment mode the picker calls `preventDefault` and
  `stopPropagation` on `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `touchstart`,
  `touchend`, `click`, `dblclick`, `auxclick` and `contextmenu`, so handlers bound to any of
  them do not run. `pointermove` drives the highlight and `click` makes the pick.
- Element rules, given `format` in `pick-start`:
  - `html`: the target, raised past `span b i em strong small code mark u s sub sup` while the
    parent is not `body`.
  - `document`: the nearest `p`, `table`, or `img` inside `section.docx`; `page` is the index
    of that section plus 1.
  - `presentation`: the direct child of the slide root (`#root > * > *`, the runtime's root
    element and the renderer's two wrappers) that contains the target. Slide background
    children (`[data-pptx-background-image]`, `[data-pptx-background-gradient]`) and the slide
    root itself resolve to the whole slide: selector `:scope`, tag `slide`, empty text. `page`
    comes from `pick-start`: the host knows the current slide from the existing `slide`
    message and sends `pick-start` again after each slide change.
- Selector: `#id` when the id is unique; otherwise `tag:nth-of-type(n)` steps up to the
  nearest ancestor with a unique id, or to `body`; at most 12 steps and 500 characters. For
  PPTX the selector is `:scope > :nth-child(n)` relative to the slide root.
- Highlight: one absolutely positioned outline element with `pointer-events: none`, removed on
  `pick-stop`.
- `pins`: for each pin, resolve the selector and accept the element when its tidied text
  starts with the first 80 characters of the stored text (or both are empty). Otherwise scan
  elements with the same tag for that text and take the first match. Report the element's
  rectangle, or `null`. Recompute on scroll, resize and DOM mutation, throttled to one
  `requestAnimationFrame`.
- Esc in comment mode posts `pick-cancel`, because the key event stays inside the iframe.

### D4. Messages

Same shapes on both bridges. The HTML bridge adds `v: 1` like its other messages.

- Host to frame: `pick-start {format, page?}`, `pick-stop`, `pins {pins: {id, selector, text, page?}[]}`.
- Frame to host: `picked {anchor, text, rect}`, `pick-cancel`, `pin-rects {rects: {id, rect | null}[]}`.

`rect` is `{top, left, width, height}` in the frame's viewport pixels. For HTML apps the inner
iframe fills the wrapper, so its viewport and the host iframe's box line up; the same holds
for the office relay.

Validation lives in each bridge's existing parser (`isIframeToParent` for HTML,
`parseViewerMessage` for office) and uses one shared `parsePickerMessage` from the picker
module: strings capped (selector 500, openTag 300, text `QUOTE_EXCERPT_CAP`), numbers finite,
rectangles inside the frame. The host drops `picked` while comment mode is off.

### D5. Host UI: `PreviewCommentLayer`

A new component in `agenta-ui/src/QuoteSelection/`. Inputs: the session id, the identity of
the document on screen, the frame's offset in the pane, the latest `picked` (or a cell selection), and the
latest `pin-rects`. It owns the draft, renders `QuoteNote` at the picked rectangle, stages with
`addQuote`, and renders numbered pins with a `HoverCard` (pointer) or `Popover` (touch) that
holds the note, the excerpt, Edit and Delete. The two primitives are deliberate: the user
asked to read a comment by hovering, and touch devices have no hover. Edit reopens
`QuoteNote` with a new `initialNote` prop and saves with `updateQuote`; Delete calls
`removeQuote`.

For an HTML app the document on screen is `RunView`'s `currentPath`, not the file selected in
the tree, because a link inside the app can load another page of the same folder. Pins and
new comments use that path.

It lives in `agenta-ui` beside `QuoteSelectionLayer` because both use the store and
`QuoteNote`, and it knows nothing about drives or iframes.

### D6. Comment mode state

A React context in `agenta-entity-ui/src/drive/` (same pattern as `HtmlAppEnvContext` and
`DriveSessionContext`) holds `{enabled, setEnabled}`. `DriveExplorer` provides it and resets
it on file change. `DriveToolbar` shows the toggle when the selected file's kind is `html`,
`document`, `presentation` or `spreadsheet` and `useDriveSessionId()` is not null; both are
already known in `DriveExplorer`, so no child reports availability upward. `RunView`,
`OfficeViewerFrame` and `SpreadsheetView` read `enabled` and send `pick-start` once their
preview is ready, and `pick-stop` when it turns off. A preview that failed to render ignores
the mode.

Alternative: a Jotai atom. Rejected because the state is scoped to one Files pane instance and
the drive already uses context for pane-scoped state.

### D7. Spreadsheet selection in the host page

`workbook.ts` adds `origin: {r, c}` to `Sheet`, taken from the `!ref` start it already
decodes. `PreviewTable` gets an optional `comments` prop that only `SpreadsheetView` passes,
so CSV previews stay unchanged. In comment mode cells take `data-row` and `data-col`; pointer
down, move and up (or Shift+click) select a rectangle; the A1 range is
`utils.encode_cell({r: origin.r + row, c: origin.c + col})` for both corners. The quote text
is a pipe table of the selected rows, limited to the selected columns, with `|` escaped and
line breaks replaced by spaces. When the selection starts below the sheet's first row, that
first row is added on top as the header; when it includes the first row, nothing is added.

### D8. Agent markdown

`quotesToMarkdown` writes the head `> **\`<displayPath>\`** (<location>)` with locations:
`element <selector>` (HTML), `page <n>` (DOCX), `slide <n>` (PPTX), `sheet <name>, <range>`
(spreadsheet). The selector, the sheet name and the HTML `openTag` line are inline code
spans built with one helper that follows the CommonMark rule: the backtick run is one longer
than the longest run inside, padded with spaces, and line breaks become spaces. So any
character in a sheet name or an attribute value is safe.

`QUOTE_HEAD` gains the alternative `\((?:element|page|slide|sheet) .+\)` before ` *$`. The
greedy `.+` runs to the last `)` on the line, so parentheses or quotes inside the location
cannot break the match, and `splitQuotedMessage` still lifts these blocks into cards.
`QuotedExcerpt` gains an optional `location` string for the card.

### D9. Freshness

The office viewer mounts a fresh frame for each file version. An HTML app does not reload by
itself: `RunView` shows a "Files changed · Reload" pill and builds a new iframe when the user
reloads. Every new frame triggers a fresh message from the frame, so the host sends `pins`
again after `rendered` (office) or `hello-ack` (HTML), and after each `slide` message (PPTX,
with only that slide's pins). Inside a running app the picker's mutation observer covers DOM
changes the app makes itself. A `null` rectangle sets
`stale: true`; a rectangle clears it. A spreadsheet comment rebuilds its cell table from the
new workbook and compares it with `Quote.text`: a missing sheet, a range outside the rows, or
different values sets `stale: true`; an identical table clears it.

## Risks / Trade-offs

- [The app or the agent-written HTML can tamper with the picker inside its own frame] → The
  frame was already untrusted. The host validates every message and a pick only fills the
  note box the user still has to confirm.
- [nth-of-type selectors break when the agent inserts siblings] → The text check in D3 finds
  the element again by text; otherwise the comment shows "changed" and still carries its text
  and selector, so the agent can find the spot.
- [Repeated text, such as two identical headings] → The selector is tried first; the text
  scan takes the first match. Accepted for version 1.
- [PPTX shapes have no names in the DOM] → The location is the slide number plus the shape
  text, which is what the agent can match in the file.
- [jsdom has no layout] → Picker unit tests cover element rules, selectors, re-anchoring and
  click suppression; pin placement is checked in the QA pass on the real app.
- [The office lane is not merged] → This work stacks on `feat/office-files-preview`.

## Migration Plan

Frontend only. No data migration. Rollback is a revert; quotes are in memory, so no stored
data refers to the new source kind.

## Size

About eight working days for one engineer: quote contract half a day, spreadsheet comments and
the comment layer two days, picker one and a half days, both bridges two days, freshness and
touch one day, stories and QA one day.
