# Status

**Updated:** 2026-08-04
**Worktree:** `/home/mahmoud/code/agenta-2-editmode`
**Branch:** `feat/file-drawer-edit-mode`, based on `origin/release/v0.109.0`
**PR base when the time comes:** `release/v0.109.0`. Never `main`.

## Where the work is

Planning is complete. No implementation code has been written.

| Phase | State |
|---|---|
| Repo research | done, written up in `research.md` |
| Design spec read and reconciled with the code | done |
| Plan | done, in `plan.md` |
| Implementation | not started |
| Tests | not started |
| Live QA | not started |

The next session starts at `plan.md` section 9, step 1.

## Decisions made and why

| Decision | Reason |
|---|---|
| Save through `mounts.uploadMountFile`, not `mounts.writeMountFile` | The generated `writeMountFile` sends no request body and would write zero bytes. Both methods reach the same `MountsService.write_file`. `research.md` correction 1. |
| Twelve spec states stored as one record plus a derived label, not a flat enum | Six of the twelve are orthogonal to the other six. A flat enum makes "dirty and in preview and in conflict" unrepresentable. |
| Buffer atom keyed by mount id, holding one nullable buffer | Matches `driveSelectionAtomFamily`. The type makes two simultaneous buffers impossible. |
| `SharedEditor` + our own `EditorProvider`, not `SimpleSharedEditor` | `SimpleSharedEditor` sniffs content and would flip a `.txt` file containing JSON into a JSON code editor. It also renders a competing header. |
| Markdown buffers pin `SET_MARKDOWN_VIEW` to true; Preview is a separate pane | Editing markdown as rich text round-trips the file through the markdown serialiser and reflows formatting the user did not touch. |
| Conflict diff uses `computeTextDiffLines`, with `DiffView` only for `json` | `DiffView` coerces everything to JSON or YAML and mangles markdown and CSV. `research.md` correction 2. |
| `canUpload` is the writable-mount gate | `mountSchema` has no read-only flag. `canUpload` is the existing answer to the same question and already gates upload, drag-drop, and the staged inbox. |
| Narrow cache invalidation, not `revalidateSessionMountsAtom` | That atom invalidates every mount in the project plus every cached body. A one-file save needs the file, its directory, and the mount listing. |
| `TEXT_CAP` moves to `driveKinds.ts` | The edit gate needs the number and must not pull the Shiki and Markdown renderer graph in to read it. One definition, re-exported from `renderers.tsx`. |
| No backend change | Deliberate. Everything above is solvable on the client. |

## Open questions

None are blocking. Each has a chosen answer; these are the ones worth revisiting if the answer
turns out badly in QA.

1. **Five-second self-write window.** After a save, conflict detection is suppressed for that
   path for five seconds while the directory listing refetches and yields the real modification
   time. A write by the agent inside that window is missed until the next save's pre-write check.
   If QA shows the agent writing that fast in practice, shorten the window and rely on the
   refetch's completion rather than a timer.
2. **No modification time from the object store.** When `mtime` comes back null, the pre-write
   check cannot fire and only the file-activity signal protects the write. Not observed in the
   local stack; recorded so a report of a silent overwrite has somewhere to start.
3. **Config-panel host has no session id.** `useDriveSessionId()` returns null there, so the
   file-activity trigger never fires in that host. The pre-write check still runs. Threading a
   session id through the config host is possible but out of scope.
4. **UTF-8 replacement on read.** `read_file` decodes with `errors="replace"`
   (`api/oss/src/core/mounts/service.py:1461-1474`), so a text file containing invalid UTF-8
   loses those bytes on read and would lose them permanently on save. Not fixable on the client.
   It is part of why only text kinds are editable.

## Known gaps, deliberately out of scope

- **`.env.local` and other multi-dot config files are not editable.** `resolveDriveFileKind`
  returns `other` for them, which is the download card. Widening the resolver changes the
  read-only viewer for every host that uses it, so it does not belong in this PR. Worth a
  follow-up.
- **No new file, rename, or delete.** Creating files stays the upload path's job.
- **CSV edits as text, not as a table.** The spec puts `csv` among the editable text kinds and
  there is no cell editor here.

## Coordination

- **PR #5643, the antd migration**, targets `main` and lands soon. It touches three lines under
  `Drives/`, all `CopyButton size="small"` becoming `size="icon-sm"`, in `DriveFilePreview.tsx`,
  `DriveHeader.tsx`, and `FolderView.tsx`. Do not touch those lines. Do not rebase onto or merge
  that branch. The post-merge fixup here is two `import ... from "antd"` lines in two new files
  (`plan.md` section 8).
- **Do not push, do not open a PR, do not merge from this worktree.** The orchestrator does that.
- Never touch `/home/mahmoud/code/agenta-2`. A release is running there.

## Live QA to run before calling it done

From `CONTEXT.md`, unchanged: edit and save `.txt`, `.csv`, `.md`, `.env`, and `.json`. For each,
confirm the bytes round-trip without reformatting, the agent sees the change on its next tool
call, and both light and dark themes render correctly. Then exercise the guard from all five exit
routes and force a conflict by having the agent write to an open file.
