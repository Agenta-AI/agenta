# Proposal

## Why

People and agents keep spreadsheets, Word documents and slide decks in agent folders, but the
Files pane cannot show them. A local reproduction on 2026-10-22 confirmed this (see
`docs/design/office-file-support/plan.md`).

## What Changes

- The Files pane, Quick Look and chat attachment viewer preview XLSX (also XLSM, XLS, ODS),
  DOCX and PPTX files. Spreadsheet cells show stored values; a formula cell with no stored value
  shows its formula, marked as a formula. DOCX renders as a page. PPTX renders slide by slide.
- Manual editing of these files in the Files pane is **NOT IMPLEMENTED** in this change. It is
  planned as v2 in `design.md`.

## Capabilities

### New Capabilities

- `drive-office-preview`: in-app previews of spreadsheet, word-processing and presentation
  files wherever drive files are shown.

### Modified Capabilities

None. The existing specs cover Slack only.

## Decisions confirmed (2026-10-22)

- The change is web only. The previews read file bytes from the existing download route, so the
  API and the runner do not change. Agents already read and edit these files with python3 and
  `openpyxl`, `python-docx` or `python-pptx` through bash; a Pi read guard, a Pi write guard and
  a 415 on `?read=` were built and then removed as not needed for this change.
- Unit tests, lint and the storybook build run as part of each task.

## Impact

- `web/packages/agenta-entities` (drive kinds) and
  `web/packages/agenta-entity-ui` (bytes hook, drive renderers, icons, media viewer). New
  dependencies in `agenta-entity-ui`: SheetJS CE (from its CDN tarball), `docx-preview`,
  `@aiden0z/pptx-renderer`, all loaded on demand.
- No change to the API, the runner, storage, the runner images or the system prompt.
- `web/oss` is not touched.
