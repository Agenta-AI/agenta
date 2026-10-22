# Tasks

## 1. API: binary read and media types (`api/oss`)

- [x] 1.1 Add `MountFileBinary` (a `MountError`) raised by `MountsService.read_file` when the first 8 KB hold a NUL byte, map it to 415 in `handle_mount_exceptions` with a message naming `/files/download`, and catch it at `core/apps/service.py:322` and `:460`; verify with unit tests modelled on `unit/mounts/test_bounded_text_read.py` (an `.xlsx` gives 415, a `.md` with one invalid UTF-8 byte gives 200, a 5 MiB binary gives 413), update `acceptance/mounts/test_mounts_basics.py:312-330` to expect 415, and check the read assertions in `unit/test_mounts_file_ops.py` near `:1150`
- [ ] 1.2 Declare the 415 response beside `TEXT_READ_TOO_LARGE_RESPONSE`, regenerate the API reference under `docs/docs/reference/`, and map 415 to `bad_request` in `web/packages/agenta-entities/src/drive/htmlApp/fsClient.ts`; verify the regenerated `get-mount-files` status codes list 415 and an `fsClient` unit test asserts the mapping
- [x] 1.3 Add the D10 media-type table to `download_mount_file` ahead of `guess_type`; verify with a unit test that asserts every D10 row, and that an `.xlsx` download returns `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` with byte-identical content on both the mounts and the session-mounts route
- [x] 1.4 Run `ruff format` and `ruff check --fix` in `api/` and verify both exit clean

## 2. Pi guard (`services/runner`)

- [x] 2.1 Add pure `binaryReadNotice(path, text)` and `blockedWriteReason(path)` with the D10 table in a module with no runner-side imports; verify unit tests on literal inputs (every D10 row, an unknown binary, a NUL-free slice of a `.parquet` with many U+FFFD, a Markdown file with two bad bytes, CSV) pass
- [x] 2.2 In `src/extensions/agenta.ts`, add `AGENTA_AGENT_FILE_GUARD` to the inert check, register the `write` `tool_call` block before `registerBuiltinGating`, and register the `read` `tool_result` handler; verify in `tests/unit/extension-tools.test.ts` with a fake `pi` that the replaced content and `isError` are correct, the block reason is returned, and a write block never reaches the gate
- [x] 2.3 Set `AGENTA_AGENT_FILE_GUARD` for Pi runs in the in-process engine (`extensionEnv`) and the sandbox engine (`pi-assets.ts` env); verify with a unit test on each env builder
- [x] 2.4 Run `pnpm run build:extension` and verify the bundle-safety gate passes
- [ ] 2.5 Run a Pi agent against `agent-files/repro/repro-sales.xlsx` on the local sandbox (the only Pi path available locally; the in-process and Daytona paths are covered by the 2.2 and 2.3 unit tests, and the PR states their live check is still open); verify each gets the guidance error, that the chat tool card and the stored session transcript show the guidance (not the undecodable text), that the agent then answers with the correct cell values, and that a `write` to the `.xlsx` leaves it byte-identical

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

- [ ] 5.1 Ask a Claude agent and a Pi agent to read a `.pptx` in `agent-files/`; verify both report the slide titles correctly
