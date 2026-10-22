# Context

## What the user can do today

- In Markdown, text and code previews, and in agent replies, the user selects text. A pill
  offers "Reply". The user writes a note, stages it, and sends it. The agent receives the
  excerpt as a markdown blockquote with the file path and line range.
- In an HTML app, a DOCX, a PPTX or an XLSX preview, the user can only look. HTML, DOCX and PPTX
  render inside sandboxed iframes, so a text selection inside them never reaches the quote
  layer. The XLSX table renders in the host page, but a cell is not text the quote layer can
  map to a location.
- To give feedback on these files, the user describes the spot in words ("the second chart on
  slide 4"). The agent then guesses where to look.

## What we want

The user turns on comment mode, points at the part of the preview they mean, and writes a
comment. The comment shows as a pin on the preview. Hover on the pin shows the full comment.
The user can send it at once or stage several and send them with one message. The agent
receives each comment with a precise, file-specific location.

## Goals

1. One picker script serves HTML apps, DOCX and PPTX, so the three formats behave the same.
2. Spreadsheets (XLSX, XLSM, XLS, ODS) support a cell or a cell range as the comment target.
3. Preview comments are quotes in the existing store. Staging, the note box, the composer
   chips, send, restore on a failed send, and the quote card in the sent message all keep
   working without a parallel code path.
4. The agent receives a location it can act on: an element selector and its text for HTML, a
   page or slide and the element text for DOCX and PPTX, and a sheet name, A1 range and cell
   values for XLSX.
5. Pins follow their element while the preview scrolls or resizes, and become stale when the
   agent changes the file and the element is gone.
6. The user can edit or delete a preview comment before it is sent, from its pin or its
   composer chip. Pins show only for unsent comments.
7. It works on touch screens. The mobile app is the product.

## Non-goals for version 1

- PDF and image comments. PDF still renders in the browser's own viewer, which exposes no text
  or coordinates. Images are a small follow-up with a normalized point.
- Comments that persist on the server, have threads, or that the agent can mark as resolved.
  Comments live in the per-session quote store, as quotes do today.
- Drawing, free-form region selection, and screenshot crops sent to the model.
- Comment mode in the chat media viewer. Version 1 is in the Files pane only.
- CSV previews.
- Comments inside web pages the agent opens in a browser tool.

## Why build on the quote store

The quote store already solves the hard user-facing parts: the draft and staged states, the
note box with Enter to stage and Cmd or Ctrl+Enter to send, chips with a "changed" badge,
restore after a failed send, and the parse-back that turns a sent message into quote cards. A
preview comment differs only in how the user picks the target and how the location is
described. Both of those are new fields on the quote's source.
