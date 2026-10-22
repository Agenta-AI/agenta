# Tasks

Work on a GitButler lane `feat/preview-comments` stacked on `feat/office-files-preview`.
Paths are relative to `web/packages/` unless they start with `web/`.

## 1. Quote contract and agent format

- [x] 1.1 Add `PreviewQuoteSource`, `ElementAnchor` and `CellAnchor` to `agenta-shared/src/quotes.ts` (design D1) and verify `pnpm --filter @agenta/shared build` passes
- [x] 1.2 Add `formatPreviewLocation`, a CommonMark-safe inline code helper, the preview head in `quotesToMarkdown`, the `openTag` line for HTML, the new `QUOTE_HEAD` alternative and `QuotedExcerpt.location` (design D8); verify with unit tests in `agenta-shared/tests/unit/` for each format's head, the round trip through `splitQuotedMessage` (including a sheet name with quotes and parentheses and an attribute value with backticks), and that existing quote tests still pass
- [x] 1.3 Add `cellsToTable(header, rows)` with `|` escaping, line-break flattening and the header rule of design D7; verify with unit tests, including a selection that starts on the first row
- [ ] 1.4 (composer chip done; `UserQuoteCard` waits for the lane `feat/transcript-redesign`, which owns that file) Show the location in `web/mobile/src/features/chat/UserQuoteCard.tsx` ("Comment on `deck.pptx` · slide 3") and in the composer chip in `agenta-chat/src/components/ComposerQuotes.tsx`; verify with a render test for each

## 2. Comment layer and note editing

- [x] 2.1 Add an `initialNote` prop to `QuoteNote` (prefilled text, "Save" label) and verify with a render test that Enter calls the stage handler with the edited text
- [x] 2.2 Build `PreviewCommentLayer` in `agenta-ui/src/QuoteSelection/` (design D5): draft from a picked rectangle, `QuoteNote`, numbered pins from position input, pin card with Edit and Delete via `HoverCard` on pointer devices and `Popover` on touch; export it from `@agenta/ui/quote-selection`; verify with component tests for stage, send, edit, delete and pins clearing after `clearQuotes`
- [x] 2.3 Add `onEdit` to `ComposerQuotes` so a click on a preview comment's chip opens a popover note editor that saves with `updateQuote`; verify with a render test, and that a text-quote chip click still does nothing
- [ ] 2.4 Add Storybook stories for `PreviewCommentLayer` (draft, staged pins, stale comment, touch) in `web/storybook` and verify `pnpm --filter @agenta/storybook lint` passes and the Storybook build succeeds

## 3. Comment mode in the Files pane and spreadsheet comments

- [x] 3.1 Add the comment mode context in `agenta-entity-ui/src/drive/` (design D6), provide it from `DriveExplorer` with reset on file change, and render the Comment toggle in `DriveToolbar` from the selected file kind and the session id (design D6); verify with a render test that the toggle shows for the four kinds in a conversation and hides outside one and for a PDF
- [x] 3.2 Add `origin` to `Sheet` in `workbook.ts` (design D7); verify with a unit test on a workbook whose `!ref` starts at `B3`
- [x] 3.3 Add the `comments` prop to `PreviewTable`, cell and range selection, A1 conversion and the quote text; wire `SpreadsheetView` to `PreviewCommentLayer`; verify with component tests for a single cell, a drag range, Shift+click, and the `B3` origin case
- [x] 3.4 Mark spreadsheet comments stale when a new file version has no such sheet, the range is outside it, or the rebuilt table differs from `Quote.text`; verify with unit tests for each case and for an unchanged file

## 4. Shared picker

- [x] 4.1 Create `agenta-shared/src/previewPicker.ts` with `installPreviewPicker(post)` and `parsePickerMessage`, export `@agenta/shared/previewPicker`, following the stub rules (design D2, D3)
- [x] 4.2 Add jsdom tests in `agenta-entities/tests/unit/previewPicker.test.ts`, using the realm helper pattern of `htmlApp.stub.test.ts` (the existing jsdom setup for shipped-string code), that evaluate the stringified picker in a fresh iframe realm: the element rule per format, selector uniqueness and caps, suppression of an app's `mousedown`, `pointerdown` and `click` handlers and of a link, the PPTX slide-background case resolving to the whole slide, Esc posting `pick-cancel`, and `pins` finding by selector, by text, and reporting `null`
- [x] 4.3 Add tests for `parsePickerMessage` covering every message type, every cap, non-finite numbers and out-of-frame rectangles

## 5. HTML app bridge

- [x] 5.1 Add the picker messages to `agenta-entities/src/drive/htmlApp/protocol.ts` and `isIframeToParent`; verify the existing protocol tests and new cases pass
- [x] 5.2 Pass the picker into the stub in `buildBridgeStub` and route picker messages over the port; extend `htmlApp.stub.test.ts` to show `pick-start` then a click produces `picked` on the port and the app's click handler does not run
- [x] 5.3 Add `startPick`, `stopPick`, `setPins`, `onPicked`, `onPinRects` and `onPickCancel` to `createHtmlAppHost` and `mockHost`; extend `htmlApp.host.test.ts` to show `picked` is dropped while comment mode is off
- [x] 5.4 Wire `RunView` to the comment mode context and `PreviewCommentLayer`, using `currentPath` as the comment's path and resending that page's pins after `hello-ack`; verify in the mobile app that picking a heading opens the note box at it, and that a comment on a linked page records that page's path

## 6. Office viewer bridge

- [x] 6.1 Add the picker messages to `officeViewer/protocol.ts` (`HostToViewer`, `ViewerToHost`, both parsers); verify with protocol unit tests
- [x] 6.2 Install the picker in `frame/runtime.ts`, route host messages to it, run `pnpm --filter @agenta/entity-ui build:office-viewers`, and verify `build:office-viewers --check` passes on the regenerated bundles
- [x] 6.3 Wire `OfficeViewerFrame` to the comment mode context and `PreviewCommentLayer`: `pick-start` with the slide number, resend `pick-start` and that slide's pins after each `slide` message, resend pins after `rendered`; verify in the mobile app on a DOCX and a PPTX

## 7. Integration QA

- [ ] 7.1 Run the mobile app from `web/mobile/` against a local stack and pass each check in a real conversation: an HTML app (pick, stage, pick, send; the agent edits both elements); a three-page DOCX at a narrow pane width (pin on the paragraph); a PPTX (pin hides on another slide and returns); an XLSX whose data starts at `B3` (correct range); edit and delete from a pin and from a chip; the agent rewrites a commented file and the comment shows "changed"
- [ ] 7.2 Repeat the HTML and PPTX checks on a phone-sized viewport with touch emulation, in light and dark theme
- [ ] 7.3 Run `pnpm lint-fix` in `web` and the package tests for `agenta-shared`, `agenta-ui`, `agenta-chat`, `agenta-entities` and `agenta-entity-ui`; all pass
