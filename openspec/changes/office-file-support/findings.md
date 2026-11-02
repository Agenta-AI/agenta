# Findings: office-file-support plan review

- Scan: `scan-codebase`, `path=openspec/changes/office-file-support`, `depth=deep`, 2026-10-22.
- Scope: every factual claim in `proposal.md`, `design.md`, `specs/*` and `tasks.md`.
- Method: four fresh-context reviewers (runner, web, API, preview libraries) read the code and ran
  the libraries; key claims were spot-checked by hand. SheetJS was run on two agent-written
  workbooks. docx-preview and pptx-renderer were run in jsdom on real fixtures. No runtime
  tests of the planned code were run (nothing is built yet).

## Notes

Claims confirmed as written:

- `pnpm run build:extension` exists (`services/runner/package.json:17`).
- Pi's `tool_result` result can replace `content` and set `isError`
  (`pi-coding-agent/dist/core/extensions/types.d.ts:1066-1072`, applied in
  `extensions/runner.js` `emitToolResult`); the read tool's `toolName` is `"read"`, write's is
  `"write"`.
- Pi `read` returns images as image content before any UTF-8 decode (`read.js` image branch).
- Office files hold NUL bytes in the ZIP local header (observed `PK\u0003\u0004\u0014\u0000`).
- SheetJS CE 0.20.3 and both renderers are Apache-2.0 (from each `package.json`).
- docx-preview renders into a shadow root without touching `document.head`; all text of the
  fixture appeared.
- pptx-renderer exposes `slideCount`, `currentSlideIndex`, `goToSlide`, a `slidechange` event,
  and allows only `http:`, `https:`, `mailto:` link targets.
- `CsvBody`, `DownloadCard` ("No preview for this type"), the size caps and the `DriveFileBody`
  switch are where the design says. `MediaViewer` resolves by name, then media type.
- The mobile app mounts `MediaViewerHost` from `@agenta/entity-ui/drive`, so it inherits the
  previews.
- `pnpm lint-fix` exists in `web/package.json`; package tests run on vitest.

## Open Findings

None. All findings below were resolved in the planning artifacts.

## Closed Findings

### Round 2: architecture, code and security review (2026-10-22)

Run with `principle-foundational-thinking`, `/code-review` (high) and `/security-review` (one
finder, one false-positive filter per finding, confidence cut at 8).

### [CLOSED] F16. Rendering DOCX in the app origin allows XSS through altChunk
- Origin: scan (security review). Category: Security. Severity: P0. Confidence: 9 (finder),
  8 (filter). Status: fixed in design.
- Evidence: docx-preview `renderAltChunks: true` by default (`docx-preview.mjs:3982`);
  `renderAltChunk` sets `iframe.srcdoc` to the file's raw HTML part with no `sandbox`
  (`:3594-3601`). A crafted `.docx` produced the iframe with `sandbox=null` and the attacker
  HTML. The app sends no CSP (`web/mobile/next.config.ts` sets only Cache-Control). Script in the
  origin can read the SuperTokens token and call `POST /keys/`.
- Fix: D6 now renders DOCX and PPTX in an opaque-origin sandboxed frame with a no-network CSP and
  `frame-src 'none'`, following the HTML-app frame; `renderAltChunks: false` and
  `externalMedia: 'block'` are defense in depth. New spec requirement "Document content cannot
  act as the user"; tasks 4.5 to 4.7 test it with the crafted file.

### [CLOSED] F17. Renderers fetch external resources named by the file
- Origin: scan (security review). Category: Privacy hardening. Severity: P3. Status: fixed.
- Evidence: pptx-renderer `externalMedia` defaults to allow; docx VML styles are copied raw.
  The false-positive filter rated it a tracking beacon, not a vulnerability (8/10).
- Fix: the frame CSP has no network source, and pptx-renderer runs with `externalMedia: 'block'`.

### [CLOSED] F18. Styled blank cells would render "undefined"
- Origin: code review. Category: Correctness. Severity: P1. Status: fixed.
- Evidence: SheetJS returns `{t:"z"}` with no `v` or `w` for a styled blank (run on a fixture).
- Fix: D5's cell table maps a `z` cell without `f` to an empty value.

### [CLOSED] F19. Workbook parse was unbounded
- Origin: code review. Category: Correctness. Severity: P1. Status: fixed.
- Evidence: one styled cell at `Z2000` widened the range to 2000 × 26 blanks (run).
- Fix: D5 reads with `sheetRows`, trims the used range to real data, and caps columns.

### [CLOSED] F20. An open preview never showed the agent's edits
- Origin: foundational review and code review. Category: Correctness. Severity: P1. Status: fixed.
- Evidence: `mountFileBlobQueryFamily` is keyed by path with `staleTime: Infinity` and kept out
  of revalidation (`driveMedia.ts:66-83`).
- Fix: D9 keys the office blob query by the listing's file version; a spec requirement and task
  4.4 cover it.

### [CLOSED] F21. Four different office extension lists
- Origin: foundational review and code review. Category: Consistency. Severity: P1. Status: fixed.
- Evidence: web, runner and API lists differed (`.odp` unblocked, `.xls` without a media type).
- Fix: D10 is one format table; each layer's copy is asserted by its own tests.

### [CLOSED] F22. Guard output not checked in the UI and transcript
- Origin: code review. Category: Correctness. Severity: P2. Status: fixed.
- Fix: task 2.5 asserts the chat tool card and stored transcript show the guidance.

### [CLOSED] F23. Read guard missed NUL-free slices of non-office binaries
- Origin: code review. Category: Correctness. Severity: P3. Status: fixed.
- Fix: D1 adds a U+FFFD ratio backstop; task 2.1 tests a `.parquet` slice.

### [CLOSED] F24. Missing Storybook stories and dark-theme checks
- Origin: code review (conventions, `web/CLAUDE.md`). Category: Conventions. Severity: P2.
  Status: fixed.
- Fix: task 4.11 adds stories and the storybook gate; every browser-pane task checks both themes.

### [CLOSED] F25. CsvBody table would be duplicated
- Origin: code review. Category: Reuse. Severity: P3. Status: fixed.
- Fix: task 4.3 extracts `PreviewTable` for CSV and spreadsheets.

### [CLOSED] F1. SheetJS drops formula cells that have no stored value
- Origin: scan. Category: Correctness. Severity: P1. Confidence: high (run). Status: fixed.
- Evidence: reading `repro-sales.xlsx` (agent-edited) with default options returns `null` for
  `D2` and `D4`; `attach-budget.xlsx` loses its `=SUM(B2:B3)` cell. The XML holds
  `<c r="D2"><f>B2+C2</f><v></v></c>`. With `{cellFormula: true, sheetStubs: true}` the cells
  come back as `{"t":"z","f":"B2+C2","v":0}`.
- Impact: every agent-written workbook would preview with blank formula columns, and `v: 0`
  would show a wrong `0` if read naively.
- Fix: D5 and task 3.2 now require both options and map `t === "z"` with `f` to `{formula}`.

### [CLOSED] F2. The Pi guard would not register in runs where the extension is inert
- Origin: scan. Category: Correctness. Severity: P1. Status: fixed.
- Evidence: `services/runner/src/extensions/agenta.ts:487-497` returns early unless one of
  eight wiring env values is set.
- Fix: D2 now adds a dedicated `AGENTA_AGENT_FILE_GUARD` flag that both engines set and that
  the inert check includes; task 2.2 registers the handlers right after the check.

### [CLOSED] F3. The write block would run after the approval gate
- Origin: scan. Category: Correctness. Severity: P1. Status: fixed.
- Evidence: `registerBuiltinGating` (`agenta.ts:272`) is a `tool_call` handler that can prompt
  the user; the first blocking handler wins.
- Impact: a user could be asked to approve a write that is then refused.
- Fix: D2 and task 2.2 register the write block before the gate.

### [CLOSED] F4. There are three Pi paths, not two
- Origin: scan. Category: Completeness. Severity: P2. Status: fixed.
- Evidence: `sandbox-routing.ts:36-60` routes Pi to in-process only with a session and run
  credential; a sessionless run on Daytona uses the sandbox engine; `local` is never routed.
- Fix: the spec scenario and task 2.4 cover in-process, local sandbox and sessionless Daytona.
  D2 records that a failed bundle install (`pi-assets.ts:590-601`, `:777-791`, logged and
  skipped) leaves the guard off in the sandbox engine, as it does for gating today.

### [CLOSED] F5. An 8 KB check on decoded text misses offset reads
- Origin: scan. Category: Correctness. Severity: P2. Status: fixed.
- Evidence: Pi `read` accepts `offset`/`limit` and truncates; the returned slice may not start
  at the file's head.
- Fix: D1 now checks the whole returned text for NUL, with the office extension list as a
  backstop.

### [CLOSED] F6. There is no session-scoped `?read=` route
- Origin: scan. Category: Correctness. Severity: P1. Status: fixed.
- Evidence: `sessions/router.py` registers only upload and download for files
  (`:1811`, `:1826`, `:1836`); `read_file` is called inline in `mounts/router.py:667-676`.
  Only `download_mount_file` (`mounts/utils.py:209`) is shared.
- Fix: removed the session-scoped read from the spec and task 1.1; the download requirement
  keeps both routes.

### [CLOSED] F7. "Only two callers use `?read=`" was false
- Origin: scan. Category: Correctness. Severity: P1. Status: fixed.
- Evidence: web `readMountFile` (`session/api/api.ts:1357`) feeds `mountFileContentQueryFamily`,
  read by the editor, repo meta, file meta, hover card, thumbnail, file source and inline image.
  Server-side, `core/apps/service.py:322`, `:401`, `:460`, `:506` call `read_file`; `:322` and
  `:460` do not catch a new error.
- Fix: the design risk now lists the callers; task 1.1 catches the new error at
  `apps/service.py:322` and `:460`. The web consumers are gated to text kinds and treat errors
  as null; task 1.1 verifies that gating did not change.

### [CLOSED] F8. An existing acceptance test asserts 200 for NUL bytes
- Origin: scan. Category: Testing. Severity: P1. Status: fixed.
- Evidence: `api/oss/tests/pytest/acceptance/mounts/test_mounts_basics.py:312-330` uploads
  `b"\x00\x01\x02\x03"` and asserts `?read=` returns 200.
- Fix: task 1.1 updates it to expect 415, and checks `unit/test_mounts_file_ops.py` near
  `:1150`. New unit tests follow `unit/mounts/test_bounded_text_read.py`.

### [CLOSED] F9. The 415 was missing from OpenAPI, docs and the HTML-app client
- Origin: scan. Category: Completeness. Severity: P2. Status: fixed.
- Evidence: only 413 is declared (`TEXT_READ_TOO_LARGE_RESPONSE`, `mounts/utils.py:~52`) and
  documented (`docs/docs/reference/api/get-mount-files.*`); `fsClient.ts` `toFsClientError`
  (`:192-220`) maps 415 to `"unavailable"`.
- Fix: new task 1.2 declares the 415 response, regenerates the API reference, and maps 415 to
  `bad_request` in `fsClient.ts`.

### [CLOSED] F10. No hook gives a body the file's bytes
- Origin: scan. Category: Completeness. Severity: P1. Status: fixed.
- Evidence: `useDriveObjectUrl` (`driveFileSource.tsx:129`) returns only an object URL; no hook
  returns a Blob for mount, local and remote sources alike.
- Fix: D9 and task 4.1 add `useDriveFileBlob(mount, path)` over the same three branches.

### [CLOSED] F11. Package placement and touch points were imprecise
- Origin: scan. Category: Consistency. Severity: P2. Status: fixed.
- Evidence: labels and chips derive from the extension (`EXT_LABELS`, `EXT_CHIPS`), so only
  `driveKindTone` and `driveIcons.tsx` switch on kind; `FileThumb.tsx` and hover cards need no
  change; Quick Look renders through `DriveFilePreview` then `DriveFileContentViewer`.
  `agenta-entities` dependencies are workspace packages plus small utilities.
- Fix: `parseWorkbook`, the bodies and all three libraries live in `agenta-entity-ui`; task
  wording now names the real touch points.

### [CLOSED] F12. docx-preview renders `javascript:` links as-is
- Origin: scan. Category: Security. Severity: P1. Confidence: high (run). Status: fixed.
- Evidence: a relationship with `Target="javascript:alert(1)"` rendered
  `<a href="javascript:alert(1)">`.
- Fix: D6 keeps the post-render sanitising for DOCX and makes it a unit test; pptx-renderer
  already filters link protocols, so it needs none.

### [CLOSED] F13. pptx-renderer measures text on `document.body`
- Origin: scan. Category: Functionality. Severity: P2. Status: fixed.
- Evidence: it appends a hidden measurement div to `document.body` unless
  `measurementRoot` is set; it also has a built-in single-slide mode with navigation APIs.
- Fix: D6 sets `measurementRoot` inside the shadow root and uses `renderMode: 'slide'` with
  `goToSlide`, `slideCount` and `slidechange` for the controls.

### [CLOSED] F14. PPTX preview pulls ECharts
- Origin: scan. Category: Performance. Severity: P3. Status: fixed.
- Evidence: hard dependency `echarts ^6.0.0`; renderer ES build 1.34 MB.
- Fix: the risk is recorded with sizes; task 4.6 measures the lazy chunk.

### [CLOSED] F15. Out-of-scope readers recorded
- Origin: scan. Category: Completeness. Severity: P3. Status: wontfix (scope).
- Evidence: Pi `bash`, `grep`, `find` can still print binary; Claude and Codex use their own
  readers; the mobile `EmbedFile` widget stays download-only.
- Decision: recorded as non-goals in the design.
