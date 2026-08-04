# Why this work exists

## What a user sees today

Open the Files drawer, pick a file, and you get a read-only preview. Markdown renders. Code
highlights. CSV becomes a table. Images and PDFs display. Anything the drawer cannot render
offers a Download button.

There is no way to change a file. To fix one line in a document the agent wrote, the user
downloads it, edits it locally, and drags it back in as an upload. The upload path exists and
works, so the round trip is possible, just slow and easy to get wrong (wrong folder, wrong
name, a stale copy).

The drawer has no answer for the other half of the problem either. The agent writes to these
mounts constantly while a turn runs. A user who edited a file in another tab and re-uploaded it
would silently overwrite whatever the agent wrote in between, with no warning and no diff.

## What we are building

Inline editing in the drawer. Select a text file, click Edit, change it, click Save. The file
is written back to the same mount at the same path. The agent's sandbox mounts that prefix, so
the next tool call reads the new bytes with no sync step.

The design is fully specified in `design/edit-mode-spec.html`. That file is authoritative for
layout, copy, and interaction. This plan does not re-open interaction design.

The shape of the interaction, in one paragraph: entering edit mode takes over the drawer's two
header rows. The header's action cluster becomes Cancel and Save. The filter toolbar underneath
is replaced by an edit bar. The tree stays visible but stops responding, so its scroll position
and expanded folders survive the round trip. One file is editable at a time. Every exit route
(closing the drawer, picking another file, changing a filter, Escape, browser unload) runs
through one discard guard.

## Goals

- Edit and save the five extensions the user will test by hand: `.txt`, `.csv`, `.md`, `.env`,
  `.json`. Bytes round-trip without silent reformatting.
- Never lose a buffer. A failed save keeps every character and offers a retry.
- Never silently overwrite the agent. When the file changed underneath an open buffer, say so
  before the write lands, and offer a diff.
- Reuse the editor components the app already ships. No textarea, no second editor, no second
  list of file extensions.
- Keep the change small enough to merge cleanly next to the in-flight antd migration branch.

## Non-goals

- No backend change. Not the write endpoint, not its response body, not the OpenAPI spec, not
  Fern regeneration. If something forces one, it goes in `status.md` as a blocker rather than
  being done quietly.
- No new file, no rename, no delete. Creating files stays the upload path's job.
- No multi-file editing, no tabs, no split view. One buffer.
- No editing of images, PDFs, audio, video, or unrecognised binaries.
- No collaborative or operational-transform merge. Conflict resolution is three explicit
  choices: look at the diff, take theirs, or overwrite.
- No autosave. Saving is always an explicit act.

## Constraints that shape the design

**The write response carries no modification time.** `MountFileWrittenResponse` returns `path`
and `size`. Conflict detection needs a modification time, so the client derives one after the
fact rather than reading one off the write. `plan.md` covers how.

**There is no read-only-mount flag.** `mountSchema` has `id`, `slug`, `name`, `session_id`.
The spec's "read-only mounts hide Edit" has no field to read. The drawer already answers the
same question for uploads with `canUpload`, and edit mode reuses that answer.

**The antd migration branch lands soon.** PR #5643 rewrites `import {Button} from "antd"` to
`import {Button} from "@agenta/ui/ui"` across the app, and `@agenta/ui/ui` does not exist on
`release/v0.109.0`. So this work cannot write forward-compatible imports. It concentrates raw
antd imports into as few new files as possible instead, and it does not touch the three lines
in `Drives/` that branch changes.

**The drawer is mounted by two different hosts.** The chat pane wraps it in a
`DriveSessionProvider`; the config panel does not. Anything that depends on the session id has
to degrade cleanly when there is no session.
