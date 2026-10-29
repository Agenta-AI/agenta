# Proposal

## Why

People cannot point at a part of an HTML app, a Word document, a slide deck or a spreadsheet
preview and tell the agent "change this". The HTML, DOCX and PPTX previews render inside
sandboxed iframes, so the existing select-text-and-reply feature cannot reach them, and a
spreadsheet cell has no line range to quote. Users describe the spot in words and the agent
guesses. No agent product we surveyed (October 2026) supports comments on office files, so
this is a gap we can close with code we already have.

## What Changes

- A **Comment** toggle in the Files pane toolbar for HTML apps, DOCX, PPTX and spreadsheet
  (XLSX, XLSM, XLS, ODS) previews, shown only inside a conversation.
- In comment mode, the HTML, DOCX and PPTX previews highlight the element under the pointer
  and pick it on click. One picker script runs inside both existing preview iframes.
- In comment mode, the spreadsheet preview selects a cell or a cell range.
- After a pick, the existing quote note box opens. The comment becomes a quote in the
  existing per-session quote store, so staging, composer chips, send, restore after a failed
  send, and the quote card on the sent message work as they do for text quotes.
- Staged comments show as numbered pins on the preview. Hover or tap shows the comment with
  Edit and Delete actions. A click on any composer quote chip opens the same note editor.
- The agent receives each comment as a quote block whose head names the location: an element
  selector, a page or a slide, or a sheet name and A1 range. A spreadsheet comment carries the
  selected cell values as a table.
- When the file changes and the commented element is gone, the comment is marked "changed",
  as text quotes are today.
- No backend, API or dependency changes.

## Capabilities

### New Capabilities

- `drive-preview-comments`: picking a location in a rendered file preview, attaching a
  comment to it, managing comments before send, and the format the agent receives.

### Modified Capabilities

None. The quote feature and the office previews have no main specs in `openspec/specs/`. The
office previews are specified in the in-flight change `office-file-support`, which this change
depends on.

## Impact

- `web/packages/agenta-shared`: quote source type and agent markdown (`quotes.ts`); a new
  `previewPicker` module.
- `web/packages/agenta-ui`: a preview comment layer next to `QuoteSelection`; an `initialNote`
  option on `QuoteNote`.
- `web/packages/agenta-chat`: composer quote chips open the note editor on click.
- `web/packages/agenta-entities`: HTML app bridge protocol, stub and host.
- `web/packages/agenta-entity-ui`: office viewer protocol, frame runtime and generated
  bundles; spreadsheet table and workbook origin; Files pane toolbar and comment mode state.
- `web/mobile`: the sent-message quote card shows the preview location.
- `web/storybook`: stories for the new components.
- Depends on the GitButler lane `feat/office-files-preview` (change `office-file-support`).
  This work stacks on it.
