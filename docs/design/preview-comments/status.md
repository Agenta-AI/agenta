# Status

Last updated: 2026-10-23.

## Current state

The plan is the OpenSpec change `openspec/changes/preview-comments/`. It validates with
`openspec validate preview-comments --strict`. No code exists yet. The next action is task
group 1 in its `tasks.md`.

## Decisions

- A preview comment is a quote with `source.kind: "preview"` in the existing quote store.
- One picker module in `@agenta/shared` serves the HTML app stub and the office viewer frame.
- DOCX and PPTX use the existing office viewer. No conversion to PDF.
- The host draws the note box, pins and pin cards. The frame only reports picks and positions.
- Pins show only for staged, unsent comments. Sending clears them; the sent message card keeps
  the comment.
- Comment mode is in the Files pane only, not in the chat media viewer.
- Spreadsheet comments are for XLSX, XLSM, XLS and ODS. CSV is out of scope.
- Users edit and delete comments before send, from the pin card or the composer chip.
- The lane `feat/preview-comments` stacks on `feat/office-files-preview`.

## Questions resolved by reading the code

- Spreadsheet origin: `workbook.ts` starts rows at the sheet's `!ref` start and drops it, so
  `Sheet` gains an `origin` field.
- PPTX shape names: the renderer writes none to the DOM. A PPTX location is the slide number
  plus the shape text.
- DOCX zoom: `getBoundingClientRect()` already returns zoomed values (checked in Chrome 152).
- HTML app updates: an app does not reload by itself; pins are re-resolved when the user
  reloads and on DOM changes inside the app.

## Blockers

None.
