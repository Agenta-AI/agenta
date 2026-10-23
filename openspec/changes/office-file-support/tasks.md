# Tasks

## 3. Drive kinds (`web/packages/agenta-entities`)

- [x] 3.1 Add `spreadsheet`, `document` and `presentation` to `DriveFileKind`, `EXT_KINDS` and `driveKindTone`; verify in `tests/unit/driveKinds.test.ts` that every D10 row resolves to its web kind in any case and the tones are set

## 4. Preview bodies (`web/packages/agenta-entity-ui`)

- [x] 4.1 Add `useDriveFileBlob(mount, path, version)` beside `useDriveObjectUrl` in `driveFileSource.tsx` covering local, remote and mount sources, with the version in the mount query key; verify with a unit test per source and a test that a new version refetches while the same version does not
- [x] 4.2 Add SheetJS CE from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` and `parseWorkbook` per D5; verify unit tests on three fixtures assert literal cells: one saved by a spreadsheet app (stored values), one written by `openpyxl` (`{formula}` cells), and one with a styled blank at `C5` and `Z2000` (empty cells, range trimmed to the data), plus sheet order and the row and column caps
- [x] 4.3 Extract `PreviewTable({rows, truncated})` from `CsvBody` and keep `CsvBody` on it; verify the existing CSV tests still pass
- [ ] 4.4 Add `SpreadsheetBody` (sheet tabs over `PreviewTable`, muted formula cells), its `DriveFileBody` case and 10 MB cap; verify in the browser pane, in light and dark themes, that `repro-sales.xlsx` shows both sheets and `=B4+C4` styled as a formula, and that the open preview updates after the agent adds a row
- [x] 4.5 Add the office viewer frame per D6: the sandboxed iframe, the `srcdoc` CSP, the host↔frame message protocol with shape validation, and the build step that turns each renderer plus its viewer script into a lazy self-contained string; verify unit tests that the host rejects malformed messages and opens only `http:`, `https:` and `mailto:` links
- [ ] 4.6 Add `DocumentBody` on the viewer frame with docx-preview (`renderAltChunks: false`); verify in the browser pane, in light and dark themes, that `repro-report.docx` shows its four paragraphs, and with the crafted altChunk `.docx` and a `javascript:` link `.docx` that no script runs in the app (no alert, `document.cookie` and the access token untouched) and the frame's console shows only CSP refusals
- [ ] 4.7 Add `PresentationBody` on the viewer frame with pptx-renderer (`renderMode: 'slide'`, `externalMedia: 'block'`) and host-side next, previous and "n / total" controls; verify in the browser pane, in light and dark themes, on a three-slide fixture that next twice shows "3 / 3", and that a slide with an external image makes no network request
- [x] 4.8 Add icons in `driveIcons.tsx` for the three kinds and the OOXML media types to `MEDIA_TYPE_KINDS` in `MediaViewer.tsx`; verify a chat attachment `budget.xlsx` opens in the spreadsheet preview
- [ ] 4.9 Verify in the browser pane that a 40 MB `.xlsx` shows "Too large to preview" and a text file renamed `.docx` shows the download card
- [ ] 4.10 Verify in the network panel that no preview library loads until a matching file opens, and record each lazy chunk's size in the PR
- [x] 4.11 Add Storybook stories under `web/storybook/stories/entity-ui/` for the three bodies (loaded, formula-only workbook, too large, unreadable); verify `pnpm --filter @agenta/storybook lint` and a storybook build pass
- [ ] 4.12 Run `pnpm lint-fix` in `web/` and smoke-check `/m`; verify lint exits clean and the Files pane renders

## 5. Integration

- [ ] 5.1 Ask an agent to read a `.pptx` in `agent-files/`; verify it reports the slide titles correctly
