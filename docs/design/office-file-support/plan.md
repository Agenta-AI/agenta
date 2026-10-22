# Office file support (XLSX, DOCX)

Status: planned. v1 is scoped for build; v2 (manual editing) is deferred.

The source of truth is now the OpenSpec change `openspec/changes/office-file-support/`
(proposal, specs, design, tasks) and its fact-check `findings.md`. This page keeps the original
reproduction; where the two differ, the OpenSpec change wins.

## Problem

People and agents put spreadsheets and Word documents in agent folders. Today:

- The Files pane shows "No preview for this type" for `.xlsx` and `.docx`.
- A Pi agent that opens one with its `read` tool gets mojibake with no error, and its `write`
  tool reports success after it overwrites a workbook with plain text.
- The JSON read endpoint returns those files as text full of U+FFFD.

## What we verified (local stack, 2026-10-22)

| Claim | Result |
|---|---|
| Upload, storage and download keep XLSX/DOCX byte-identical | True |
| `GET /mounts/{id}/files?read=` garbles them | True (1,867 and 14,604 U+FFFD in two test files) |
| Download sends the OOXML Content-Type | False: it sends `application/octet-stream` |
| Files pane has no XLSX/DOCX preview | True |
| Claude-harness agent can read and update XLSX/DOCX | True: it uses `python3` + `openpyxl` / `python-docx` through bash, unprompted, and edits in place without loss |
| Pi `read` returns garbage with no error | True (run against Pi's real tool) |
| Pi `edit` corrupts a DOCX | False: it fails safely with "Could not find the exact text" |
| Pi `write` replaces a workbook with text and reports success | True |
| Chat composer accepts XLSX/DOCX attachments | True: the agent chat composer has `accept=""`; the agent read an attached workbook from `attachments/` with `openpyxl` |
| Workbooks saved by `openpyxl` carry computed formula values | False: `openpyxl` writes the formula only, so every agent-created or agent-edited workbook has no cached values |

The sandbox and runner images already ship `openpyxl`, `python-docx`, `python-pptx`, `pypdf`
and `pandas`. Nothing is missing in storage or in the images.

## v1: preview, agent read, close the gaps

Requirements agreed on 2026-10-22:

- File types: XLSX, DOCX and PPTX. XLS, XLSM and ODS come with the spreadsheet parser. `.doc`
  and `.ppt` (legacy binary) stay download-only.
- DOCX looks like a Word page.
- Spreadsheet cells show values. A formula cell with no stored value shows its formula, muted,
  because agent-written workbooks never carry stored values.
- Previews appear in the Files pane, in Quick Look and in chat attachments.
- Agents can read all three types; chat attachments of these types work.

Three independent PRs. None depends on another.

### PR A. Files pane preview (`web/packages`)

Data shape. A new parse result for workbooks:

```ts
type SheetCell = {value: string} | {formula: string}

interface Workbook {
    sheets: {name: string; rows: SheetCell[][]; truncated: boolean}[]
}
```

Changes:

1. `agenta-entities/src/drive/driveKinds.ts`: add kinds `spreadsheet`
   (`.xlsx .xlsm .xls .ods`), `document` (`.docx`) and `presentation` (`.pptx`) to
   `DriveFileKind` and `EXT_KINDS`, and to the label, chip and tone tables.
2. `parseWorkbook(bytes: ArrayBuffer): Workbook`, a pure function over SheetJS CE. A cell with
   a stored value becomes `{value}`; a formula cell without one becomes `{formula}`. Rows cap
   per sheet like CSV.
3. `agenta-entity-ui/src/drive/renderers.tsx`:
   - `SpreadsheetBody` reuses the `CsvBody` table and adds sheet tabs. A `{formula}` cell
     renders muted, with the formula text.
   - `DocumentBody` renders with `docx-preview` into an isolated container (shadow root) and
     strips `javascript:` links.
   - `PresentationBody` renders with `@aiden0z/pptx-renderer` into an isolated container, one
     slide at a time with next and previous controls.
   - All three fetch bytes through the existing blob path (`fetchMountFileBlob`), add a `case`
     in `DriveFileBody`, and join the size-capped kinds (10 MB; 25 MB for PPTX, which carries
     images) so larger files get `DownloadCard` "Too large to preview".
   - Each library loads with a dynamic `import()` only when such a file opens.
4. `MediaViewer.tsx`: add the OOXML media types to `MEDIA_TYPE_KINDS`, so an attachment whose
   name has no extension still resolves. Named attachments resolve by extension already.
5. Icons and thumbnails (`driveIcons.tsx`, `DriveTypeMark.tsx`, `FileThumb.tsx`) for the three
   new kinds.

Libraries:

| Library | Version | License | Note |
|---|---|---|---|
| SheetJS CE | 0.20.3 | Apache-2.0 | Install from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. The npm `xlsx` package is stuck at 0.18.5 with known CVEs. |
| `docx-preview` | 0.4.1 | Apache-2.0 | Layout-faithful, read-only. |
| `@aiden0z/pptx-renderer` | 1.4.0 | Apache-2.0 | HTML/SVG DOM; charts through ECharts, so it is the heaviest of the three. No animations or speaker notes. |

Tests: `parseWorkbook` against two fixtures with literal expected cells: one saved by Excel
(stored values) and one saved by `openpyxl` (formulas only). `resolveDriveFileKind` for each
new extension.

### PR B. Pi agents read office files safely (`services/runner`)

One seam covers both Pi engines: the Agenta Pi extension (`src/extensions/agenta.ts`) loads
in the in-process engine (`pi-session-factory.ts`) and in the sandbox engine (`pi-assets.ts`).

1. `tool_result` hook on `read`: when the returned text contains a NUL character, the file is
   binary. Replace the content with an actionable error that names the file type and the way
   to read it, for example: "`report.xlsx` is a binary Excel workbook. Read it with `python3`
   and `openpyxl` through `bash`." Image results are untouched (Pi already returns them as
   images).
2. `tool_call` hook on `write`: block a write to an office-container extension
   (`.xlsx .xlsm .xls .docx .doc .pptx .ppt .odt .ods`) with the same kind of guidance.
3. `edit` needs no change: it already fails safely.

Both rules are pure functions (`binaryReadNotice(path, text)`, `blockedWriteReason(path)`) with
unit tests on literal inputs. Rerun the Pi probe from the verification step and assert the new
messages.

No system-prompt change. The guard gives the guidance at the moment the agent needs it, and the
Claude harness already finds the Python path without help.

### PR C. API gaps (`api/oss`)

1. `GET /mounts/{id}/files?read=` (`core/mounts/service.py` `read_file`): when the first 8 KB
   contain a NUL byte, raise a typed error that maps to HTTP 415 and names the download route,
   instead of returning U+FFFD text. Text with a few bad bytes still decodes as today.
   Callers: the Files pane text path (text kinds only) and the HTML-app `fs.read`; neither
   expects binary.
2. `GET /mounts/{id}/files/download` (`apis/fastapi/mounts/utils.py`): resolve the OOXML and
   ODF media types from an explicit table before `guess_type`, so the result does not depend on
   the container's mime database.

Tests: an API test that uploads a real XLSX, asserts 415 on `?read=`, and asserts the download
Content-Type is
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

### v1 done when

- Opening `agent-files/repro/repro-sales.xlsx` shows both sheets, with the agent-added row's
  formula shown muted; `repro-report.docx` shows its heading and paragraphs; a sample `.pptx`
  shows its slides.
- The same previews open from a chat attachment.
- A Claude agent and a Pi agent each read a `.pptx` correctly.
- A Pi agent asked to read the same files ends with correct contents (through the guard and
  Python), and a Pi `write` to `.xlsx` is refused.
- The two API assertions above pass.

## v2: manual editing in the Files pane (deferred)

Shared foundation, needed by both editors:

- Generalize `useDriveFileEditor` from a text draft to a draft that each kind encodes: text kinds
  save text, office kinds save bytes.
- Save through the raw `PUT /mounts/{id}/files` (already binary-safe) with `If-Match` on the
  file's etag (already supported by the router), so a manual save never silently overwrites the
  agent's concurrent change, and the reverse. On conflict, offer reload or keep-mine.

DOCX: `@eigenpal/docx-editor-react` 1.9.0 (Apache-2.0, ProseMirror, edits the Word model
directly, React 18/19). SuperDoc is out (AGPL-3.0).

XLSX: no open-source editor is proven to round-trip without loss. Univer's XLSX import/export
is paid (Pro). SheetJS CE drops styles on write. Before choosing:

1. Prototype a round-trip of real workbooks (formulas, styles, merged cells, charts,
   conditional formatting) through FortuneSheet + `@corbe30/fortune-excel` (MIT) and through
   ExcelJS cell edits (MIT, last release 2023). Diff the output; the diff decides.
2. Open read-only, with a note, any workbook that holds features the chosen editor drops, and
   always `.xlsm`.

Until v2 ships, the working path is to ask the agent in chat.
