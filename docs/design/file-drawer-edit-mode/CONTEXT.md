# File drawer edit mode — shared context brief

**Read this first. Every fact below was verified against the code on 2026-08-04. Do not
re-derive it. Do verify anything you intend to contradict.**

## Where you are working

- **Worktree:** `/home/mahmoud/code/agenta-2-editmode` (an isolated `git worktree`, NOT the
  user's main checkout). Everything happens here. Never touch `/home/mahmoud/code/agenta-2`.
- **Branch:** `feat/file-drawer-edit-mode`, based on `origin/release/v0.109.0`.
- **PR base when the time comes:** `release/v0.109.0`. Never open a PR against `main`.
- `web/node_modules` is installed in this worktree.

## The goal

Let a user open a text file in the Files drawer, click **Edit**, change it in place, and
save it back to the mount. The agent picks the change up because the sandbox FUSE-mounts the
same object-store prefix.

The design is fully specified. Do not invent interaction design.

- **Design spec:** `docs/design/file-drawer-edit-mode/design/edit-mode-spec.html`
  It is a `.dc.html` prototype. The meaningful parts are (a) the markup, which shows layout
  and copy, and (b) the `<script type="text/x-dc">` block at the bottom, which holds a
  `STATES` list and a `NOTES` object spelling out every state, its trigger, and its rules.
  Read the script block first, then the markup. Strip inline styles when reading:
  `python3 -c "import re;print(re.sub(r' style=\"[^\"]*\"','',open('<path>').read()))"`.

The spec's design-system CSS is explicitly derived from the app's own antd tokens, so use
the existing theme tokens (`colorText`, `colorBorderSecondary`, and so on). Do not
hard-code the hex values from the spec.

### The twelve states the spec defines

`read` (viewing, Edit offered) · `clean` (buffer open, Save off) · `dirty` · `preview`
(rendered markdown) · `saving` · `saved` · `error` (save failed, buffer preserved) ·
`conflict` (agent wrote underneath) · `confirm` (discard guard) · `code` (codeOnly, no
markdown toggle) · `locked` (image/PDF/binary — Edit not rendered) · `capped` (text but over
the size cap — Edit rendered but disabled with a tooltip).

## Verified facts about the existing code

### Backend — already complete, no API work needed

- `PUT /mounts/{mount_id}/files?path=...` writes raw request-body bytes.
  Handler `write_mount_file` at `api/oss/src/apis/fastapi/mounts/router.py:570`,
  registered at line 283, guarded by `Permission.EDIT_MOUNTS`.
- Service: `api/oss/src/core/mounts/service.py:1476` → `put_object` into the mount's prefix.
- Response model `MountFileWrittenResponse` (`api/oss/src/apis/fastapi/mounts/models.py:102`)
  returns **only `path` and `size`. There is no `mtime` in the response.** The spec assumes
  mtime comes back from the write. It does not. Solve this on the client (for example, mark
  the just-written path as self-authored and suppress the conflict banner for it) rather
  than changing the backend. A backend change would drag in Fern regeneration and turn a
  frontend PR into a cross-stack one. If you conclude a backend change is unavoidable, say
  so explicitly in the plan instead of doing it silently.
- The Fern client already exposes it: `mounts.writeMountFile` in
  `web/packages/agenta-api-client/src/generated/api/resources/mounts/client/Client.ts:1065`.
  Reach it through a per-resource accessor from `@agenta/sdk/resources` (see
  `web/AGENTS.md`), never the `@agenta/sdk` root barrel.
- The agent sees saved bytes with no extra sync: the sandbox geesefs-mounts the same
  prefix (`services/runner/src/engines/sandbox_agent/mount.ts`).

### Frontend — the Drives area

All paths below are under `web/oss/src/components/Drives/`.

| File | What it is |
|---|---|
| `DriveExplorer.tsx` | Two-pane shell (tree + preview) and the one header |
| `DriveHeader.tsx` | Breadcrumb, name, action cluster. Spec: takes an `editing` flag and swaps the cluster for Cancel / Save |
| `DriveToolbar.tsx` | Search, origin filter, visibility toggles. Spec: replaced wholesale by the edit bar while editing |
| `DriveFilePreview.tsx` | Right pane. Header band (or headerless in "chrome mode") over the content viewer |
| `DriveFileContentViewer.tsx` | Kind-keyed crossfade wrapper around `DriveFileBody` |
| `renderers.tsx` | The renderer registry. `TextBody` at line 129, `CodeBody` at ~line 172, `TEXT_KINDS` at line 587, `DriveFileBody` switch at ~line 625 |
| `driveKinds.ts` | `resolveDriveFileKind(path)` and `driveCodeLanguage(path)` — the single extension→kind resolver. Use it; do not add a second extension list |
| `driveFileSource.tsx` | `useDriveFileText(mount, path)` reads content (local blob or mount query) |
| `driveMedia.ts` | `uploadMountFile` (multipart, used by drag-drop), download helpers |
| `FilesDrawer.tsx` | The antd drawer shell; body is lazily imported |

Content reads go through `mountFileContentQueryFamily` and invalidate on
`mountFileContentQueryKey` (both in
`web/packages/agenta-entities/src/session/state/mounts.ts`).

`TEXT_CAP = 1.5 * 1024 * 1024` in `renderers.tsx` is the existing inline-text size cap. The
spec's `capped` state must reuse this constant, not a new one.

### The editor components the spec says to reuse — all confirmed to exist

- **`SharedEditor`** — `web/packages/agenta-ui/src/SharedEditor/`. Props confirmed present:
  `header`, `footer`, `editorType: "border" | "borderless"`,
  `state: "default" | "filled" | "disabled" | "readOnly" | "focus" | "typing"`,
  `initialValue`, `value`, `handleChange`, `editorProps`, `disableDebounce`,
  `onFocusChange`, `maxPasteChars`. Read `web/packages/agenta-ui/src/SharedEditor/README.md`.
- **`SimpleSharedEditor`** — `web/oss/src/components/EditorViews/SimpleSharedEditor/` is the
  app-level wrapper most call sites use (Playground, evaluators, session drawer). Look at how
  `web/oss/src/components/SharedDrawers/SessionDrawer/components/SessionMessagePanel/index.tsx`
  uses it before writing anything new.
- **Markdown source ↔ preview** — `markdownViewAtom(id)`, `TOGGLE_MARKDOWN_VIEW`,
  `SET_MARKDOWN_VIEW`, all exported from `@agenta/ui` (see
  `web/packages/agenta-ui/src/Editor/index.ts:56,77`). Working example:
  `web/packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx` — note its
  comment that setting the atom alone is not enough, you must also dispatch the command.
- **codeOnly mode** — `EditorProps` with `codeOnly: true` plus a `language`. See
  `web/packages/agenta-ui/src/Editor/README.md`.
- **`DiffView`** — exported from `@agenta/ui/editor` (`Editor/index.ts:41`). Powers the
  conflict banner's "View diff".

### Conflict detection

- `mountFileSchema` **does** carry `mtime` (epoch ms) —
  `web/packages/agenta-entities/src/session/core/schema.ts:145`.
- There is an existing per-session file-activity signal:
  `web/packages/agenta-entities/src/session/state/fileActivity.ts`. Entries carry
  `resolved: {mountId, path}`, an `effect` (`created`/`modified`/…), and sometimes the
  previous cached body. This is the "file-activity signal that already exists" the spec
  refers to. Use it.

### Things the spec assumes that are NOT true today — resolve these in the plan

1. **No mtime on the write response** (see above).
2. **There is no read-only-mount flag.** `mountSchema` has only `id`, `slug`, `name`,
   `session_id`. The spec's "read-only mounts hide Edit entirely" has nothing to read.
   Decide: gate on the `EDIT_MOUNTS` permission if the frontend can see it, otherwise
   treat every mount as writable and note the gap. Do not invent a schema field.

## Constraint: the antd migration branch

PR #5643 (`fe-refactor/migration-away-from-antd`) migrates `@agenta/ui` off antd onto Radix
+ cva. It is **641 files, ~55k insertions, targeting `main`, not yet merged anywhere**, and
it is expected to land within hours.

What this means for you, verified:

- **Textual conflict risk in Drives is tiny.** That branch touches exactly three files under
  `Drives/`, one line each — `DriveFilePreview.tsx`, `DriveHeader.tsx`, `FolderView.tsx`,
  all changing a shared `CopyButton`'s `size="small"` to `size="icon-sm"`. **Do not touch
  those three lines.** If you leave them alone the merge is clean.
- **The forward-compat cost is real.** That branch rewrites `import {Button} from "antd"` to
  `import {Button} from "@agenta/ui/ui"` across the app. `@agenta/ui/ui` **does not exist on
  `release/v0.109.0`**, so you cannot write forward-compatible imports today. Therefore:
  **keep raw antd imports few and concentrated in as few new files as possible**, so the
  post-merge fixup is a short mechanical pass. Prefer `SharedEditor` /
  `SimpleSharedEditor` / existing shared components over raw antd wherever there is a
  choice.
- Do not attempt to rebase onto or merge that branch. Just stay out of its way.

## Repo conventions you must follow

Read `AGENTS.md` at the repo root and `web/AGENTS.md`. The ones that bite hardest here:

- **State:** Jotai atoms. `atomWithQuery` for data. Never `useEffect` + manual state for
  fetching. Avoid prop drilling; use atoms for state shared across the tree.
- **Styling:** Tailwind utility classes, semantic antd theme tokens
  (`bg-colorBgContainer`, `text-colorText`, `border-colorBorderSecondary`). No raw hex, no
  CSS-in-JS, no inline `style={{}}`. **Implement and check both light and dark themes.**
- **API calls:** Fern client via `@agenta/sdk/resources`, `{queryParams: {...}}` not
  axios `params`, zod validation at the boundary with `safeParseWithLogging`.
- **Comments:** at most ONE short line per comment. No multi-line prose blocks. This repo
  has an unusually high existing comment density in `Drives/` — match the terse style of the
  newer files, do not imitate the long header essays.
- **Before committing:** run `pnpm lint-fix` inside `web/`.
- **Package placement:** the `agenta-package-practices` skill decides app-layer versus
  `@agenta/*` package. This feature is Drives-specific, so it almost certainly belongs in
  the app layer under `web/oss/src/components/Drives/`. Only promote something to a package
  if it is genuinely reused.

## Tests

- Frontend unit tests in this area use vitest. There is a working local example:
  `web/oss/src/components/Drives/dropEntries.test.ts`. Run with the web test script (check
  `web/package.json` for the exact command).
- Test the **state machine and the pure helpers** hard: dirty tracking, save-enabled logic,
  kind→editable decision, size-cap decision, conflict detection, guard routing. Those are
  where the bugs live and they are cheap to test.
- Do not write brittle snapshot tests of the rendered drawer.

## The QA matrix the user asked for

Live QA must cover editing and saving: `.txt`, `.csv`, `.md`, `.env`, `.json`. Note that
`.env` has no extension-based kind today — check what `resolveDriveFileKind` returns for it
and make sure it lands in a text kind rather than falling through to the download card.
`.csv` currently renders as a parsed table, so decide explicitly what editing a CSV does
(the spec lists `csv` among the editable text kinds, so it must become a source buffer while
editing).

## Working agreement

- Stay inside the worktree. Do not run `git push`, do not open a PR, do not merge. The
  orchestrator does that at the end.
- Commit as you go with clear messages so later phases can see what changed.
- If you hit something that makes the plan wrong, write it down in
  `docs/design/file-drawer-edit-mode/open-questions.md` rather than silently improvising.
