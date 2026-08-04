# File drawer edit mode

Let a user open a text file in the Files drawer, click Edit, change it in place, and save it
back to the mount. The agent picks the change up with no extra sync, because its sandbox
mounts the same object-store prefix.

## Reading order

Read these in order. Each answers a different question.

| File | Question it answers |
|---|---|
| `CONTEXT.md` | What is already true in the code? Verified facts, worktree rules, the QA matrix. Written before this plan and kept as-is. |
| `context.md` | Why does this work exist, what is in scope, what is out? |
| `research.md` | What did reading the code change about the brief? Every place the spec or `CONTEXT.md` is wrong, with the file and line that proves it. |
| `plan.md` | How is it built? State machine, file-by-file changes, editor API, save path, conflict detection, tests. |
| `status.md` | Where is it now? Progress, open decisions, what the next session should pick up. |
| `design/edit-mode-spec.html` | What does it look like and what does the copy say? Authoritative for interaction and wording. |

`CONTEXT.md` and `context.md` are two different files. On a case-insensitive filesystem they
collide, so refer to them by their full names in commit messages and never rename one to match
the other.

Read `research.md` before `plan.md`. The plan depends on three corrections that only make sense
once you have seen the evidence.

## Terms used across these files

- **Drive**: the file tree the Files drawer shows. One drive folds one or two mounts together.
- **Mount**: a durable object-store prefix bound to a session or an artifact. Files live here.
  A mount has an id, a slug, and a name, and nothing else the frontend can read.
- **Kind**: the file category the drawer resolves from the extension (`markdown`, `text`,
  `code`, `json`, `csv`, `html`, `image`, `pdf`, `audio`, `video`, `other`). One resolver owns
  it: `resolveDriveFileKind` in `web/oss/src/components/Drives/driveKinds.ts`.
- **Buffer**: the in-memory copy of one file's text while the user edits it. The drawer holds
  at most one buffer at a time.
- **Original**: the bytes as read when the buffer opened. Dirty means draft differs from
  original.
- **File-activity signal**: the per-session log of write-shaped tool calls the chat records
  while a turn streams. Lives in
  `web/packages/agenta-entities/src/session/state/fileActivity.ts`.
- **Affordance**: whether the header offers Edit for the selected file, and in what condition
  (`offer`, `capped`, `hidden`).

## Scope of the change

Frontend only. The backend write endpoint, its permission check, and its object-store path all
already exist and are unchanged. No Fern regeneration. No new API.

Everything new lives in the app layer under `web/oss/src/components/Drives/`. Nothing is
promoted into a `@agenta/*` package, because nothing here is reused outside the drive surfaces.
