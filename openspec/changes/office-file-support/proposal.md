# Proposal

## Why

People and agents keep spreadsheets, Word documents and slide decks in agent folders, but the
Files pane cannot show them, a Pi agent reads them as garbage with no error, and a Pi agent can
overwrite one with plain text while reporting success. A local reproduction on 2026-10-22
confirmed each of these (see `docs/design/office-file-support/plan.md`).

## What Changes

- The Files pane, Quick Look and chat attachment viewer preview XLSX (also XLSM, XLS, ODS),
  DOCX and PPTX files. Spreadsheet cells show stored values; a formula cell with no stored value
  shows its formula, marked as a formula. DOCX renders as a page. PPTX renders slide by slide.
- A Pi agent that reads a binary file with its file-read tool gets an error that names the file
  type and how to read it, instead of undecodable text.
- A Pi agent that writes text to an office-format path is refused with the same kind of
  guidance, instead of destroying the file.
- **BREAKING** (API): `GET /mounts/{mount_id}/files?read=<path>` returns HTTP 415 for binary
  content instead of a string full of U+FFFD.
- The mount file download route returns the correct media type for OOXML and ODF files.
- Manual editing of these files in the Files pane is **NOT IMPLEMENTED** in this change. It is
  planned as v2 in `design.md`.

## Capabilities

### New Capabilities

- `drive-office-preview`: in-app previews of spreadsheet, word-processing and presentation
  files wherever drive files are shown.
- `agent-binary-file-guard`: how the Pi harness's file-read and file-write tools treat binary
  and office-format files.
- `mount-file-content-api`: the content rules of the mount file read and download routes for
  binary files.

### Modified Capabilities

None. The existing specs cover Slack only.

## Decisions confirmed (2026-10-22)

- The 415 on `?read=` ships.
- All three parts ship as separate branches: API, Pi guard, web previews.
- Unit tests, lint and the storybook build run as part of each task.
- Live Pi verification runs on the local sandbox only; the in-process and Daytona paths rely on
  unit tests until an environment is available.

## Impact

- `web/packages/agenta-entities` (drive kinds, HTML-app file client) and
  `web/packages/agenta-entity-ui` (bytes hook, drive renderers, icons, media viewer). New
  dependencies in `agenta-entity-ui`: SheetJS CE (from its CDN tarball), `docx-preview`,
  `@aiden0z/pptx-renderer`, all loaded on demand.
- `services/runner/src/extensions/agenta.ts` (the Agenta Pi extension, loaded on every Pi path)
  and the env builders of both Pi engines.
- `api/oss/src/core/mounts/`, `api/oss/src/apis/fastapi/mounts/`,
  `api/oss/src/core/apps/service.py`, one acceptance test, and the generated API reference.
- No change to storage, the runner images, the system prompt, or the Claude and Codex harnesses.
- `web/oss` is not touched.
