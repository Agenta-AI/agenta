# Preview comments

Users point at a part of a rendered file preview, write a comment, and send it to the agent.
Version 1 covers HTML apps, DOCX documents, PPTX presentations and XLSX spreadsheets. It builds
on the existing quote-to-reply feature instead of adding a second system.

## Reading order

| File | Answers |
|---|---|
| [context.md](context.md) | What the user can do today, what we want, goals and non-goals. |
| [research.md](research.md) | How the current previews and the quote store work, with file references, and what other products do. |
| [OpenSpec change `preview-comments`](../../../openspec/changes/preview-comments/) | The binding plan: proposal, behavior spec, design (data shapes, picker, messages, agent format) and tasks. |
| [qa.md](qa.md) | The break-it test matrix, what it fixed, and the open findings. |
| [status.md](status.md) | Current progress, decisions taken, and open questions. Source of truth for state. |

## Terms used in every file

- **Quote store.** The per-session, in-memory list of quotes in
  `web/packages/agenta-ui/src/QuoteSelection/store.ts`. A quote is a piece of a file or of an
  agent reply plus the user's note. The composer sends staged quotes with the next message.
- **Staged.** A quote the user has confirmed. It shows as a chip in the composer and goes out
  with the next message.
- **Preview comment.** A quote whose source is a picked element or a cell range in a rendered
  preview, instead of selected text.
- **Comment mode.** A toggle on the preview. While it is on, hovering highlights the element
  under the pointer and a click picks it.
- **Picker.** One self-contained script that runs inside the preview iframe. It draws the hover
  highlight, describes the picked element, and reports pin positions.
- **Pin.** A small marker the host draws over the preview at a comment's location. Hover (or tap
  on touch screens) shows the comment.
- **Host.** The Agenta page that holds the preview iframe.
- **Frame.** The sandboxed iframe that renders the file. It runs with `allow-scripts` and
  without `allow-same-origin`, so the host cannot read its DOM. The two talk only through
  messages.
- **HTML app.** Any `.html` file the Files pane runs (see `DriveHtmlApp`). It talks to the host
  over a `MessagePort` bridge.
- **Office viewer.** The frame that renders DOCX with `docx-preview` and PPTX with
  `@aiden0z/pptx-renderer`. It lives on the lane `feat/office-files-preview`.
- **Stale.** The existing quote flag for "the file changed and the excerpt is gone". Preview
  comments reuse it when an anchor no longer resolves.

## Scope rule

Frontend work happens only in `web/mobile/` and `web/packages/`. Do not edit `web/oss/`.
