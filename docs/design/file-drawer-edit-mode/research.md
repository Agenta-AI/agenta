# What reading the code changed

Everything below was read in the worktree at `/home/mahmoud/code/agenta-2-editmode` on
2026-08-04. Where the design spec or `CONTEXT.md` says one thing and the code says another, the
code wins and the correction is stated here with the file and line that proves it.

## Corrections

### 1. The Fern `writeMountFile` sends no request body

`CONTEXT.md` and the spec both route the save through `mounts.writeMountFile`. That method
cannot carry the file contents.

`web/packages/agenta-api-client/src/generated/api/resources/mounts/client/Client.ts:1065`
builds the request with `queryParameters` only and passes no `body` to `core.fetcher`. Its
request type confirms it:

```ts
// packages/agenta-api-client/src/generated/api/resources/mounts/client/requests/WriteMountFileRequest.ts
export interface WriteMountFileRequest {
    mount_id: string;
    path: string;
}
```

The backend handler reads `content = await request.body()`
(`api/oss/src/apis/fastapi/mounts/router.py:579`). A body-less PUT therefore writes zero bytes.
Calling this method would truncate every file it touched. The OpenAPI spec never described the
raw body, so Fern generated a method that silently drops it.

**What we do instead.** `mounts.uploadMountFile` is generated correctly: it builds a multipart
form, appends the file, and sends it
(`.../mounts/client/Client.ts:822-866`). Its request type carries the payload:

```ts
export interface BodyUploadMountFile {
    mount_id: string;
    path?: string | null;
    file: core.file.Uploadable;
}
```

Both endpoints land on the same service method. `upload_mount_file`
(`api/oss/src/apis/fastapi/mounts/utils.py:66-91`) reads the upload and calls
`mounts_service.write_file(project_id, mount_id, path, content)`, which is the exact call
`write_mount_file` makes. `write_file` (`api/oss/src/core/mounts/service.py:1476-1492`) does a
plain `put_object`: full overwrite, no collision renaming, same `EDIT_MOUNTS` permission check
on both routes, same `MountFileWrittenResponse` shape back.

So the multipart route is not a detour around the intended endpoint. It is the same write,
reached through the one generated method that can carry bytes. This keeps the change frontend-only
and needs no Fern regeneration.

### 2. `DiffView` cannot show a diff of arbitrary text

The spec assigns "View diff" to `DiffView`. `DiffView` handles JSON and YAML and nothing else.

`web/packages/agenta-ui/src/Editor/DiffView.tsx:117-123`:

```ts
function detectLanguage(content: string): "json" | "yaml" {
    const detected = getContentLanguage(content)
    // DiffView only supports json/yaml, default to json for text
    return detected === "text" ? "json" : detected
}
```

Its props type declares `language?: "json" | "yaml"`, and `normalizeContent` /
`convertContent` re-serialise through `JSON.parse` or `yaml.load`, falling back to `"{}"` when
parsing fails. Handed a markdown or CSV file it produces an empty or mangled diff.

**What we do instead.** `computeTextDiffLines(original, modified, options)` is exported from
`@agenta/ui/diff` (`Editor/utils/diffUtils.ts:481`) and returns `ExtendedDiffLine[]` with
`type: "context" | "added" | "removed" | "fold"` plus line numbers. It is already used this way
by `packages/agenta-entities/src/workflow/commitDiff/classify.ts:167`. The conflict diff renders
that list. `DiffView` is still used, but only for the `json` kind, where its language handling
is correct.

### 3. `SharedEditor`'s README describes props that do not exist

`packages/agenta-ui/src/SharedEditor/README.md` documents `containerVariant: "bordered" |
"borderless" | "textarea"` and `state: "filled" | "default"`. Neither matches `types.ts`:

```ts
// packages/agenta-ui/src/SharedEditor/types.ts
editorType?: "border" | "borderless"
state?: "default" | "filled" | "disabled" | "readOnly" | "focus" | "typing"
```

There is no `containerVariant` prop. Write against `types.ts` and `SharedEditor.tsx`, not the
README.

### 4. `EditorProps.language` is a six-value union, not a Shiki language id

`driveCodeLanguage(path)` returns Shiki ids: `python`, `shellscript`, `rust`, `go`, `plaintext`,
and about twenty more (`driveKinds.ts:24-61`). The editor accepts far fewer:

```ts
// packages/agenta-ui/src/Editor/plugins/code/types.ts
export type CodeLanguage = "json" | "yaml" | "code" | "python" | "javascript" | "typescript"
```

Passing `"shellscript"` type-errors. `SimpleSharedEditor` works around this today by casting
(`"html" as string as CodeLanguage`, `SimpleSharedEditor/index.tsx:95`). We add a small pure
mapper instead, and unit-test that every entry in `CODE_LANGS` maps into the union.

### 5. `SET_MARKDOWN_VIEW(true)` means raw markdown source, not preview

The command's meaning is the reverse of what the segmented control's labels suggest.
`markdownPlugin.tsx:279` states it plainly, and the handler at line 230 confirms it: when
`nextMarkdownView` is true the root's first child becomes a `CodeNode` with language
`"markdown"`; when false it is rich text.

`markdownViewAtom(id)` is only an `atomWithStorage` CSS flag
(`Editor/state/assets/atoms.ts:7-9`). Setting it does not swap the Lexical nodes. The working
pattern is `MarkdownViewSynchronizer` in
`packages/agenta-ui/src/ChatMessage/components/ChatMessageEditor.tsx:88-104`: dispatch
`SET_MARKDOWN_VIEW` from a `useLayoutEffect`, then dispatch it again from a deferred
`requestAnimationFrame` to cover the mount race where the effect runs before `MarkdownPlugin`
has registered the command.

This matters for correctness, not just for the toggle. A markdown file edited in rich-text mode
round-trips through the markdown serialiser on every keystroke, which reflows the user's
original formatting. So a markdown buffer pins `SET_MARKDOWN_VIEW` to `true` for its whole life.

### 6. `mountFileSchema.mtime` is populated, despite a comment saying it is not

`useSessionDrive.ts:68-73` says the listing carries no mtime and calls it a backend ask. That
comment is stale. The backend sets it in every listing path:
`service.py:1145`, `:1262`, `:1315` all construct `MountFile(path=..., size=..., mtime=obj.mtime)`,
and `MountFile.mtime` is `Optional[int]`, "Object-store LastModified as epoch milliseconds"
(`api/oss/src/core/mounts/dtos.py:63-74`). `mountFileSchema` parses it
(`packages/agenta-entities/src/session/core/schema.ts:145`).

So conflict detection has a real modification time to compare, and it comes from the directory
listing rather than from the write response.

### 7. `.env` already resolves to a text kind

`CONTEXT.md` asked us to check. `resolveDriveFileKind(".env")` returns `"text"`: the pattern is
`/\.(txt|log|env)$/i` (`driveKinds.ts:65`) and the leading dot of a dotfile satisfies the `\.`.
Verified against the actual regex:

| path | matches `/\.(txt|log|env)$/i` |
|---|---|
| `.env` | yes |
| `agent-files/.env` | yes |
| `.env.local` | **no** |
| `notes.txt` | yes |

`.env.local` falls through every pattern and lands on `"other"`, which is the download card and
is not editable. That is a real gap and it is recorded in `status.md` rather than fixed here,
because widening the resolver changes the read-only viewer's behaviour too.

`.env` is a dotfile, so it only shows when the toolbar's hidden-files toggle is on. It defaults
to on (`useDriveFilters.ts:16`, `useState(true)`), so it is visible by default.

## Facts confirmed, no correction needed

- **The backend write path is complete.** `PUT /mounts/{mount_id}/files` at
  `router.py:570`, registered at `:283`, guarded by `Permission.EDIT_MOUNTS`. Response model
  `MountFileWrittenResponse` returns `path` and `size` only
  (`apis/fastapi/mounts/models.py:102-105`). No `mtime`, as `CONTEXT.md` said.
- **`TEXT_CAP = 1.5 * 1024 * 1024`** is module-private in `renderers.tsx:41`. It gates the text
  bodies at `renderers.tsx:611-619`, where the `csv` kind is checked alongside `TEXT_KINDS`
  rather than being in it (`TEXT_KINDS` is `markdown, text, code, json, html`,
  `renderers.tsx:587`).
- **`CodeBody` pretty-prints JSON before display** (`renderers.tsx:178-186`:
  `JSON.stringify(JSON.parse(content), null, 2)`). The read view is therefore not the file. A
  buffer seeded from it would reformat the file on save.
- **`useDriveFileText(mount, path)`** (`driveFileSource.tsx:64`) returns the raw content string
  from `mountFileContentQueryFamily`, or a local blob's text when a `DriveFileSourceContext`
  provides one. Local-blob mode has no mount and cannot be written to.
- **`canUpload` is the existing writable-drive answer**: `isAgentFileUploadsEnabled() &&
  !explicitFiles && !!drive.mount` (`useDriveUploads.ts:67`). It already gates the header upload
  button, drag-and-drop, and the staged inbox.
- **The Drives area already talks to the backend through axios**, not Fern
  (`driveMedia.ts` uses `@/oss/lib/api/assets/axiosConfig` throughout, including
  `uploadMountFile` at `:168`). We do not follow that precedent, because Fern has a working
  method for this call and `web/AGENTS.md` requires Fern for new code.
- **`callFern` swallows failures.** It logs and returns `null` for anything that is not an abort
  (`packages/agenta-entities/src/session/api/client.ts:96-105`). A save needs to tell a failure
  from a success, so it does not use `callFern`.
- **`projectScopedRequest(projectId, appId?, abortSignal?, maxRetries?)`** puts `project_id` on
  `queryParams` and threads the abort signal (same file, `:47-63`). Fern repackages aborts as
  `AgentaApiError`; `isAbortError` unwraps them.
- **`useDriveSessionId()`** (`driveSessionContext.tsx:31`) returns the enclosing conversation's
  session id, and `null` outside a conversation. The config-panel host does not mount the
  provider.
- **Query keys and families** in `packages/agenta-entities/src/session/state/mounts.ts`:
  `mountFileContentQueryKey(projectId, mountId, path)` at `:38`,
  `mountDirQueryKey(projectId, mountId, path, includeGitignored)` at `:42`,
  `mountFilesQueryKey(projectId, mountId, includeGitignored)` at `:30`.
  `revalidateSessionMountsAtom` at `:219` invalidates every mount in the project, which is far
  wider than a single-file save needs.
- **Vitest is the test runner** for this area: `oss/package.json` `test:unit` is `vitest run`,
  and `Drives/dropEntries.test.ts` is a working local example that mocks the axios module.

## Places the code disagrees with itself

Worth knowing, not worth fixing in this PR:

- `useSessionDrive.ts:68-73` claims mount listings carry no mtime. They do (correction 6).
- `SharedEditor/README.md` documents a prop name the component does not have (correction 3).
- `renderers.tsx:5-6` says matching is extension-based because "the listing carries no
  content-type (same backend gap as mtime)". The mtime half of that sentence is stale for the
  same reason.
