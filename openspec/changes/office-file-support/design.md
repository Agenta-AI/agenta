# Design

## Context

See `proposal.md` for motivation and `docs/design/office-file-support/plan.md` for the
2026-10-22 reproduction. `findings.md` records the fact-check of this design. The facts that
shape the approach:

- Storage is already binary-safe. Mount upload, raw `PUT`, download and the sandbox's FUSE mount
  keep exact bytes. Nothing changes there.
- The Files pane picks a renderer by file kind (`resolveDriveFileKind` in
  `agenta-entities/src/drive/driveKinds.ts`, the switch in `DriveFileBody` in
  `agenta-entity-ui/src/drive/renderers.tsx`). Unknown kinds fall to `DownloadCard`. File labels
  and chips derive from the extension, so `.xlsx`, `.docx` and `.pptx` already read "XLSX",
  "DOCX" and "PPTX". Only `driveKindTone` and `driveIcons.tsx` switch on kind, and every switch
  has a `default`, so a missed spot fails silently rather than at compile time.
- Bodies get bytes only as object URLs today (`useDriveObjectUrl` in `driveFileSource.tsx`),
  over three sources: mount files (`mountFileBlobQueryFamily`), local staged files, and remote
  attachment URLs.
- Quick Look renders through `DriveFilePreview` then `DriveFileContentViewer` then
  `DriveFileBody`. `MediaViewer` resolves an attachment's kind by name, then media type. The
  mobile app mounts the same `MediaViewerHost`.
- Agents already read and edit office files through `bash` and Python; the sandbox and runner
  images ship `openpyxl`, `python-docx`, `python-pptx` and `pandas`. The API and the runner do
  not change.

## Goals / Non-Goals

**Goals:**
- Preview libraries load only when a matching file opens.

**Non-Goals:**
- Manual editing (v2, below).
- Recalculating formulas in the browser.
- Changes to the API, the runner, the harnesses, the images, or the system prompt. A Pi read
  guard, a Pi write guard and a 415 on `?read=` were built and removed: the previews read bytes
  from the existing download route, and agents reach these files through Python.
- Previews for `.doc` and `.ppt`, and in the mobile `EmbedFile` widget (it stays download-only).

## Decisions

### D4. Preview libraries, all in `agenta-entity-ui`
| Kind | Library | License | Why |
|---|---|---|---|
| spreadsheet | SheetJS CE 0.20.3, from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | Apache-2.0 | Widest format coverage (XLSX, XLSM, XLS, ODS). The npm `xlsx` package is stuck at 0.18.5 with published CVEs. |
| document | `docx-preview` 0.4.1 | Apache-2.0 | Page-form rendering; the agreed look. Depends only on `jszip`. |
| presentation | `@aiden0z/pptx-renderer` 1.4.0 | Apache-2.0 | Maintained (Oct 2026), single-slide mode with navigation APIs, filters link protocols. |

They live in `agenta-entity-ui` with the bodies (`agenta-entities` holds only workspace packages
and small utilities). Each is behind a dynamic `import()` inside its body component.
Rejected: ExcelJS (no release since 2023), `mammoth` (drops layout), `pptx-preview` (no public
source repository listed), SuperDoc (AGPL-3.0), Univer (XLSX import is in the paid edition).

### D5. Workbook data shape and parsing
```ts
type SheetCell = {value: string} | {formula: string}
interface Workbook {
    sheets: {name: string; rows: SheetCell[][]; truncated: boolean}[]
}
```
`parseWorkbook(bytes)` is a pure function over SheetJS read with
`{cellFormula: true, sheetStubs: true, sheetRows: ROW_CAP + 1}`. Without the first two options
SheetJS drops formula cells that have no stored value; `sheetRows` stops SheetJS from parsing
rows the preview will never show (all verified on SheetJS 0.20.3). The cell mapping is a closed
table:

| SheetJS cell | `SheetCell` |
|---|---|
| `t: "z"` with `f` | `{formula: "=" + f}` (its `v: 0` is ignored) |
| `t: "z"` without `f` (a styled blank) | `{value: ""}` |
| any other type | `{value: w ?? String(v ?? "")}` |
| missing | `{value: ""}` |

The used range is trimmed to the last row and column that hold a non-empty cell (one styled cell
at `Z2000` otherwise widens the range to 2000 × 26 blanks), then columns are capped at
`COL_CAP` (50) with `truncated` set. `openpyxl`, which agents use, never stores computed values,
so the formula case is common.

### D6. DOCX and PPTX render in a sandboxed viewer frame, not in the app origin
The two renderers write DOM straight from untrusted file content, so React's escaping does not
apply, and a missed vector runs as the app. One is confirmed: docx-preview's default
`renderAltChunks: true` puts the file's raw HTML part into an `<iframe srcdoc>` with no
`sandbox`, which inherits the app origin (verified with a crafted `.docx`). Script there can read
the SuperTokens access token and mint an API key. A shadow root isolates styles only, not
script, and the app sends no CSP.

So the security boundary is the frame, following the HTML-app pattern
(`agenta-entities/src/drive/htmlApp/frame.ts`):

- The body mounts `<iframe sandbox="allow-scripts">` (no `allow-same-origin`, so the document
  has an opaque origin and no access to the app's cookies, storage, token or API).
- Its `srcdoc` carries a CSP of `default-src 'none'; script-src 'unsafe-inline';
  style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none';
  frame-src 'none'; object-src 'none'; form-action 'none'`. The `frame-src 'none'` closes
  navigation-based exfiltration, as in the HTML-app wrapper; with no `https:` source the file
  cannot fetch remote images either (this also closes the tracking-pixel vector in pptx-renderer
  and docx VML styles).
- The renderer and a small viewer script ship inline in the `srcdoc`, built as a self-contained
  string per renderer (the HTML-app stub ships the same way). The body loads that string with a
  dynamic `import()`, so nothing loads until a matching file opens.
- The host sends the file bytes once by `postMessage` with the `ArrayBuffer` transferred. The
  frame sends back only fixed messages: `ready`, `rendered {slideCount}`, `slide {index}`,
  `failed`, and `open-link {url}`. The host validates each message's shape and opens a link only
  for `http:`, `https:` or `mailto:` with `noopener`.
- Defense in depth inside the frame: docx-preview runs with `renderAltChunks: false`, and
  pptx-renderer runs with `externalMedia: 'block'` and `renderMode: 'slide'`. pptx-renderer's
  `measurementRoot` is a node in the frame document.
- Slide controls and the "n / total" indicator are host React outside the frame, driven by the
  `slide` and `rendered` messages, so they keep the app theme.
- Alternative rejected: a shadow root in the app document (style isolation only); stripping
  dangerous nodes after render (a deny list against a library that writes DOM from file data;
  kept only as the `renderAltChunks` flag, not as the boundary).

SheetJS stays in the app origin: it parses to `SheetCell` strings that React renders as text, and
no HTML path (`sheet_to_html`, the `h` field) is used.

Styling:
- Dark theme: the document and slide surfaces keep their own white paper (they are pictures of a
  page) inside a frame border that uses the app's theme tokens. The spreadsheet table, its tabs
  and the muted formula style use theme tokens in both themes.
- The spreadsheet body and `CsvBody` share one extracted `PreviewTable({rows, truncated})`; a
  `{formula}` cell is its only addition.

### D7. Size limits
10 MB for spreadsheets and documents, 25 MB for presentations (they embed images), as new
branches beside the existing caps. Parsing runs on the main thread; the limit bounds the freeze.

### D9. One bytes hook for every source, keyed by file version
`useDriveFileBlob(mount, path, version)` in `driveFileSource.tsx` mirrors `useDriveObjectUrl`'s
three branches (local `File`, remote attachment blob, mount blob) and returns
`{blob, isPending, failed}`. The office bodies parse `await blob.arrayBuffer()` while mounted
(the blob queries use `gcTime: 0`).

The existing `mountFileBlobQueryFamily` is keyed by path with `staleTime: Infinity` and is kept
out of drive revalidation on purpose, so an open preview would never show an agent's edit. The
office bodies therefore pass the file's version from the drive listing (`etag`, else
`mtime` and `size`, the same fingerprint `useChangedHint` uses) into the query key. A changed
file refetches once when the listing refreshes at turn end; an unchanged file never refetches.
Media bodies keep their current key.

### D10. Format table
`driveKinds.ts` maps extensions to web kinds, and `MediaViewer.tsx` maps the media types for
attachments; their unit tests assert the rows below.

| Extension | Web kind | Media type |
|---|---|---|
| `.xlsx` | spreadsheet | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| `.xlsm` | spreadsheet | `application/vnd.ms-excel.sheet.macroEnabled.12` |
| `.xls` | spreadsheet | `application/vnd.ms-excel` |
| `.ods` | spreadsheet | `application/vnd.oasis.opendocument.spreadsheet` |
| `.docx` | document | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `.doc` | other | `application/msword` |
| `.odt` | other | `application/vnd.oasis.opendocument.text` |
| `.pptx` | presentation | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
| `.ppt` | other | `application/vnd.ms-powerpoint` |
| `.odp` | other | `application/vnd.oasis.opendocument.presentation` |

## Risks / Trade-offs

- [Bundle weight] → pptx-renderer hard-depends on ECharts (renderer ES build about 1.3 MB plus
  ECharts). docx-preview is about 1 MB unpacked. Each viewer string is a lazy chunk; nothing
  loads until a matching file opens.
- [A renderer vector we did not find] → It runs in an opaque-origin frame with no network and no
  navigation, so it reaches nothing of the user's. This is why the frame, not a sanitiser, is the
  boundary.
- [The frame needs inline script] → `script-src 'unsafe-inline'` applies only inside the
  sandboxed frame, which holds nothing to steal; the app's own policy is unchanged.
- [SheetJS from a tarball URL] → The lockfile pins the integrity hash. Upgrades are a manual
  URL change.
- [Rendering fidelity] → Neither renderer is pixel-exact. The download action stays in the
  header.
- [Main-thread parsing] → Size limits bound it. A worker can follow if real files stall.

## Migration Plan

One web PR. Rollback is a revert; no data changes.

## v2 (NOT IMPLEMENTED): manual editing

- Generalise `useDriveFileEditor` from a text draft to a draft each kind encodes, and save office
  kinds as bytes through the raw `PUT /mounts/{id}/files` with `If-Match` on the file's etag
  (both supported today), so a manual save and an agent write never silently overwrite each
  other.
- DOCX editor: `@eigenpal/docx-editor-react` (Apache-2.0). It renders file content in the app
  origin, so v2 needs a security review of its rendering paths equal to D6 before adoption, or
  the same frame boundary.
- XLSX editor: choose after a round-trip prototype of FortuneSheet with `@corbe30/fortune-excel`
  against ExcelJS cell edits on real workbooks. Workbooks with features the editor drops, and all
  `.xlsm` files, open read-only.
