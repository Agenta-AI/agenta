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
- The Claude harness already reads and edits office files through `bash` and Python; the sandbox
  and runner images ship `openpyxl`, `python-docx`, `python-pptx` and `pandas`.
- Pi's stock `read` tool decodes every non-image file as UTF-8, and its `write` tool writes any
  string. Pi runs on three paths: in-process (a session with a run credential, routed from
  Daytona), the sandbox engine on a local sandbox, and the sandbox engine on Daytona (sessionless
  runs and evaluations). The Agenta Pi extension (`services/runner/src/extensions/agenta.ts`)
  loads on all three: through `extensionFactories` in-process, and as a bundle installed into the
  sandbox otherwise. It is inert unless one of its wiring env values is set (`agenta.ts:487-497`).
- `MountsService.read_file` decodes with `errors="replace"` after a 4 MiB cap (413). It is called
  by the mounts router (`?read=`) and by `core/apps/service.py` (`:322`, `:401`, `:460`, `:506`).
  There is no session-scoped `?read=` route. The download helper (`download_mount_file`) is
  shared by both routers and uses `mimetypes.guess_type`, which returned
  `application/octet-stream` for `.xlsx` in the local stack.

## Goals / Non-Goals

**Goals:**
- One rule for "binary" in each layer, applied at the boundary where bytes become text.
- Preview libraries load only when a matching file opens.

**Non-Goals:**
- Manual editing (v2, below).
- Recalculating formulas in the browser.
- Changes to the Claude or Codex harness, the images, or the system prompt.
- Guarding Pi `bash`, `grep` or `find` output, which can still print binary bytes.
- Previews for `.doc` and `.ppt`, and in the mobile `EmbedFile` widget (it stays download-only).

## Decisions

### D1. Binary means a NUL character in the content
The API treats a file as binary when its first 8 KB of bytes contain NUL, the heuristic `git`
uses. The runner guard checks the whole text that `read` returned for `\u0000` (NUL survives
UTF-8 decoding), because `read` can return a slice from an `offset`. Two backstops cover a
slice that holds no NUL: a path in the D10 table, and a slice whose first 4,096 characters are
more than 10% U+FFFD (undecodable bytes; real text with a few bad bytes stays far below). Office files always match: the ZIP local
file header has NUL bytes within its first 8 bytes.
Alternatives: an extension list alone (misses unknown binary formats); a U+FFFD ratio (fails on
mixed text); a sniffing library (a dependency for no gain).

### D2. The Pi guard lives in the Agenta Pi extension
- A `tool_result` handler on `read` replaces binary text with a guidance error
  (`ToolResultEventResult` replaces `content` and sets `isError`). Image results carry no text
  part and pass through.
- A `tool_call` handler on `write` blocks office-format paths with the existing `blockReason`
  shape. It is registered **before** `registerBuiltinGating`, so the user is never asked to
  approve a write that is then refused.
- Both decisions are pure functions (`binaryReadNotice(path, text)`, `blockedWriteReason(path)`)
  in a module with no runner-side imports, so they pass the bundle-safety gate in
  `scripts/build-extension.mjs` and test without Pi.
- The extension's inert check gains a dedicated flag, `AGENTA_AGENT_FILE_GUARD`, which both
  engines set for every Pi run; the handlers register right after the check. A plain `pi`
  session outside Agenta stays untouched.
- If the bundle fails to install in a sandbox, the runner logs and continues today; the guard is
  then off for that run, the same as built-in gating. This is accepted and logged, not changed.
- `edit` needs no handler: it already fails safely on office files (verified).

Alternative: wrap Pi's operations in `inprocess/tools/file-tools.ts`; rejected because it covers
only the in-process path.

### D3. No system-prompt change
The guidance arrives in the tool error when it is needed. The Claude harness finds the Python
path without prompting. A prompt line can follow if a Pi run shows the guidance is ignored.

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

### D8. API read and media types
- `read_file` checks the first 8 KB for NUL before decoding and raises a new `MountFileBinary`
  (a `MountError`), mapped to 415 in `handle_mount_exceptions`. The 4 MiB cap still runs first, so
  a large binary file gets 413.
- `core/apps/service.py:322` and `:460` catch the new error the way they treat their other
  cases; `:401` reads a manifest (text) and `:506` is already wrapped.
- The route declares the 415 response next to `TEXT_READ_TOO_LARGE_RESPONSE`, the API reference
  is regenerated, and the HTML-app `fsClient.ts` maps 415 to `bad_request`.
- The download helper looks up an explicit OOXML and ODF table before `guess_type`.

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

### D10. One format table
Every layer reads the same table. Each layer holds its own copy (TypeScript in the web and the
runner, Python in the API), and each copy's unit test asserts the rows below, so a drift fails
a test.

| Extension | Web kind | Media type | Pi write blocked |
|---|---|---|---|
| `.xlsx` | spreadsheet | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | yes |
| `.xlsm` | spreadsheet | `application/vnd.ms-excel.sheet.macroEnabled.12` | yes |
| `.xls` | spreadsheet | `application/vnd.ms-excel` | yes |
| `.ods` | spreadsheet | `application/vnd.oasis.opendocument.spreadsheet` | yes |
| `.docx` | document | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | yes |
| `.doc` | other | `application/msword` | yes |
| `.odt` | other | `application/vnd.oasis.opendocument.text` | yes |
| `.pptx` | presentation | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | yes |
| `.ppt` | other | `application/vnd.ms-powerpoint` | yes |
| `.odp` | other | `application/vnd.oasis.opendocument.presentation` | yes |

## Risks / Trade-offs

- [The 415 is a contract change] → Web `readMountFile` consumers are gated to text kinds and
  treat an error as null; the HTML-app client maps 415 explicitly; the generated Fern clients
  surface it as a generic `ApiError`. One acceptance test asserted 200 for NUL bytes and is
  updated.
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
- [Mis-detection] → UTF-16 text contains NUL and is treated as binary, as `git` does.
- [Guard missing after a failed bundle install] → Logged today; same exposure as built-in gating.

## Migration Plan

Three independent PRs: API, Pi guard, preview. Each ships alone. Rollback is a revert; no data
changes.

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
