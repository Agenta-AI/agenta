# Research

Paths are relative to `web/packages/` unless they start with `web/`.

## The quote store and how quotes reach the agent

- `agenta-shared/src/quotes.ts` defines `Quote` and `QuoteSource`. A source is
  `{kind: "message"}` or `{kind: "file", path, displayPath, fileName, mountId, startLine,
  endLine}`. The file has no React and no DOM.
- `quotesToMarkdown` writes each staged quote as a blockquote ahead of the message text. The
  first line is `> **\`path\`** (L3–L5)`. `splitQuotedMessage` parses the same shape back out
  with the regex `QUOTE_HEAD`, so a new head format must also extend that regex.
- `QUOTE_EXCERPT_CAP` (2000 characters) caps each excerpt on the wire.
- `agenta-ui/src/QuoteSelection/store.ts` holds quotes per session in module memory. It has
  `addQuote`, `updateQuote`, `removeQuote`, `clearQuotes` (drops staged quotes after a send),
  `restoreQuotes`, and `submitSessionMessage`.
- `QuoteSelectionLayer.tsx` turns a text selection inside a `[data-quotable]` element into a
  draft and opens `QuoteNote`. `QuoteNote` only needs `anchor: {top, left, bottom}` and
  `bounds`, so a preview comment can reuse it unchanged.
- `useQuoteFreshness.ts` re-locates file quotes when the file text changes and sets `stale`.
- `web/packages/agenta-chat/src/components/ComposerQuotes.tsx` renders the chips. It branches
  on `quote.source.kind === "file"`.
- `web/mobile/src/features/chat/UserQuoteCard.tsx` renders the cards above a sent message from
  the output of `splitQuotedMessage`.
- No backend stores quotes or file comments. `api/oss/src/core/annotations/` is for trace
  annotations and is unrelated.

## HTML apps

- `DriveExplorer.tsx` runs any `.html` file in the Files pane through `DriveHtmlApp`
  (`renderers.tsx`), which renders `htmlApp/HtmlAppBody.tsx` and `htmlApp/RunView.tsx`.
- `agenta-entity-ui/src/drive/htmlApp/assemble.ts` builds the app document and inlines
  `BRIDGE_STUB` ahead of the app's own scripts.
- `agenta-entities/src/drive/htmlApp/frame.ts` wraps the app in a second sandboxed iframe. The
  wrapper relays only the first `hello`, which carries a `MessagePort`. Every later message
  travels over that port. Messages the app posts to `window.parent` reach the wrapper, not the
  host.
- `agenta-entities/src/drive/htmlApp/stub.ts` holds the port in a closure. It is written as a
  self-contained ES2017 function that ships as a string, and it is unit-tested by evaluating the
  string in jsdom. It already listens for clicks to turn link clicks into `nav` messages.
- `agenta-entities/src/drive/htmlApp/protocol.ts` defines `IframeToParent` and
  `ParentToIframe`, all with `v: 1`. The sandbox is `allow-scripts allow-forms`.
- Consequence: the picker for HTML apps must run inside the stub's closure, or receive a
  function from it, to use the port. A separate `window.postMessage` would stop at the wrapper.

## Office viewer (lane `feat/office-files-preview`)

- `agenta-entity-ui/src/drive/officeViewer/protocol.ts` defines `HostToViewer` (`render`,
  `goto`) and `ViewerToHost` (`ready`, `rendered`, `slide`, `failed`, `open-link`), and the
  validators `parseHostMessage` and `parseViewerMessage`. The sandbox is `allow-scripts` and the
  CSP blocks all network access, so the picker must be bundled into the viewer script.
- The outer `relay` document forwards every message both ways, so new message types need no
  relay change.
- `officeViewer/frame/runtime.ts` (`runViewer`) receives messages and renders. `frame/docx.ts`
  and `frame/pptx.ts` are bundled into `officeViewer/generated/*` by
  `agenta-entity-ui/scripts/build-office-viewers.mjs`.
- DOCX: `docx-preview` renders real DOM. Pages are `section.docx`; paragraphs and tables are
  normal elements. `fitPages` applies CSS `zoom` to the wrapper. In Chrome 152,
  `getBoundingClientRect()` inside a zoomed element already returns zoomed values, so the
  picker needs no correction.
- PPTX: `@aiden0z/pptx-renderer` 1.4.0 renders DOM with `div` and `span` elements and uses
  `<canvas>` for a few parts. It shows one slide at a time (`renderMode: "slide"`). Each
  shape, picture, table, chart or group (from master, layout and slide) is a direct child of
  the slide root `container.firstElementChild.firstElementChild`. It writes no shape name or
  id to the DOM; the only shape marker is `data-pptx-shape-background`.
- `officeViewer/OfficeViewerFrame.tsx` holds the iframe, listens on `window` for messages from
  `frame.contentWindow`, and draws the slide stepper.

## XLSX

- `agenta-entity-ui/src/drive/workbook.ts` parses with SheetJS into `SheetCell[][]` per sheet,
  capped at 501 rows and 50 columns.
- `renderers.tsx` renders `SpreadsheetView`, which renders `PreviewTable`, in the host page.
  The first row of the sheet is the table header.
- To verify before building: whether `parseWorkbook` keeps the sheet's own origin. If a sheet's
  used range starts at `B3`, table cell (0, 0) is `B3`, not `A1`. The A1 address the agent
  receives must use the sheet's coordinates.

## Where the quote layer is mounted

- `DriveFilePreview.tsx` mounts `QuoteSelectionLayer` over `DriveFileContentViewer`, which
  renders every non-HTML body, including the office bodies.
- `quotable.ts` (`useQuotableFile`) reads the session id from `useDriveSessionId()`. Outside a
  conversation there is no session and quoting is off. Preview comments follow the same rule.

## What other products do

A separate competitive scan (October 2026) found the following:

- Element picking in a rendered preview is common. Codex, Cursor Design Mode, VS Code 1.132,
  Windsurf, v0, Replit, Lovable, Figma Make and Claude Code's preview all use the same pattern:
  turn on a mode, hover to highlight, click to pick, and the element lands in the chat input.
- Batching several comments before one send exists in VS Code, Codex and Agentation.
- Comments that persist with threads exist only in Vercel's toolbar and, with known bugs, in
  Claude Design.
- No product found lets the user comment on a DOCX, PPTX, XLSX or PDF preview inside an agent
  chat. This is the gap version 1 fills for three of the four formats.
- Known bugs elsewhere: the selection is lost on send (Figma Make, Claude Design). Version 1
  shows the comment as a chip and a card so the user sees what the agent receives.
- Hypothesis re-anchors annotations with layered selectors: a DOM path first, then the text
  quote with prefix and suffix, then fuzzy search. Version 1 uses only the first two steps
  without prefix and suffix: selector, then exact text.
