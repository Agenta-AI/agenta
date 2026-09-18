# Agent HTML apps — phase 1 contracts (lane 0)

## Purpose

Six lanes build agent HTML apps in parallel: the bridge host (A), the API deltas (B), the UI
(C), the platform ops (D), the stub and kit (E), and the starters (F). This document and the
TypeScript next to it are the one place they agree. Everything that can be a type is a type, so
a mismatch fails in `tsc` instead of in a demo.

Source of truth (in `@agenta/entities`, exported from `@agenta/entities/drive`):

| File                                                               | What                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `web/packages/agenta-entities/src/drive/htmlApp/protocol.ts`       | Messages, error codes, caps, sandbox/CSP, kit names, host types |
| `web/packages/agenta-entities/src/drive/htmlApp/manifest.ts`       | `AppManifest`, `parseManifest`, `isAppFolderListing`            |
| `web/packages/agenta-entities/src/drive/htmlApp/mockHost.ts`       | `createMockHtmlAppHost` — the behavioural reference and fixture |
| `web/packages/agenta-entities/tests/unit/htmlApp.manifest.test.ts` | Every manifest rule, one assertion each                         |
| `web/packages/agenta-entities/tests/unit/htmlApp.mockHost.test.ts` | Every host rule, including If-Match and the MessageChannel path |

### How to propose a change

Open a PR against `feat/agent-apps-contracts` that changes the TypeScript and this file together,
and say which lane needs it and why. Never fork a type locally ("my own `FsRequest` with one more
field") — the point of the lane is that a change here breaks every consumer's typecheck at once,
which is the review. Additive fields on messages are cheap; renames and new error codes need a
note in the PR so the other lanes can grep for the impact.

## Bridge protocol

Defined in `protocol.ts`. The host renders the app's entry file in a sandboxed iframe, posts a
`hello` with `window.postMessage` and a transferred `MessagePort`, and then everything travels over
the port. Every message carries `v: 1`. Requests carry a numeric `id` the response echoes.

iframe → parent (`IframeToParent`):

| Message          | Fields                                         | Meaning                                     |
| ---------------- | ---------------------------------------------- | ------------------------------------------- |
| `FsRequest`      | `id, method, path, body?, force?`              | One `window.agenta.fs` call                 |
| `HelloAck`       | `type: "hello-ack"`                            | The stub installed `window.agenta`          |
| `NavMsg`         | `type: "nav", href`                            | The app wants to navigate; the host decides |
| `ScriptErrorMsg` | `type: "error", message, source?, line?, col?` | Uncaught error inside the iframe            |

parent → iframe (`ParentToIframe`):

| Message         | Fields                                          | Meaning                                        |
| --------------- | ----------------------------------------------- | ---------------------------------------------- |
| `Hello`         | `type: "hello", dir, canWrite, visible, tokens` | First message; the port rides along with it    |
| `FsResponse`    | `id, ok: true, result, etag?`                   | Success; `result` shape is `FsResults[method]` |
| `FsFailure`     | `id, ok: false, error: {code, message, etag?}`  | Failure                                        |
| `VisibilityMsg` | `type: "visibility", visible`                   | Tab shown/hidden                               |
| `ChangedMsg`    | `type: "changed", paths`                        | Files changed outside the app (agent, upload)  |
| `ThemeMsg`      | `type: "theme", tokens`                         | Kit tokens changed (theme switch)              |

Methods (`FsMethod`): `read`, `readJSON`, `write`, `writeJSON`, `list`, `exists`, `stat`,
`remove`. `write`, `writeJSON` and `remove` need the `read-write` grant (`WRITE_METHODS`).

Error codes (`BridgeErrorCode`):

| Code          | When                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `scope`       | Path leaves the app dir (absolute, `..`, backslash, control chars, `%2e`)                           |
| `read_only`   | Write method under a `read` grant                                                                   |
| `not_found`   | No such file (read/readJSON/stat/remove)                                                            |
| `conflict`    | If-Match mismatch (HTTP 412); `error.etag` is the server's current etag, `null` if the file is gone |
| `too_large`   | Read over 4 MB or write body over 1 MB                                                              |
| `unavailable` | Host detached, or the network call failed                                                           |
| `bad_request` | Missing body on write, non-JSON body on `writeJSON`, non-JSON file on `readJSON`                    |

### Automatic If-Match

The app never handles etags itself. The host (and the mock) remembers the etag it last returned
for a path — from `read`, `readJSON`, `list`, `stat` or a successful `write` — and sends it as
`If-Match` on the next `write`/`remove` of that path. If the server answers 412 the app gets
`conflict` with the etag the server holds now; the usual recovery is to re-read (which refreshes
the cached etag) and retry. `force: true` on the request skips the header and overwrites. A path
the app has never read is written unconditionally. `externalWrite` on the mock is how a test or
story simulates the agent editing a file underneath the app: the stored content changes, the
cached etag does not, and a `changed` message is queued (delivered immediately when attached,
flushed right after `hello` otherwise).

Paths are relative to the app dir, `/`-separated, no leading slash. `list("")` lists the app dir
itself; every other method rejects the empty path with `scope`.

## Manifest

Defined in `manifest.ts`. A folder is an app when a file named `app.json` sits directly in it
(`isAppFolderListing`) and `parseManifest` returns non-null. Parsing is tolerant: only bad JSON,
`agenta_app !== 1`, a missing `name`, or an `entry` with `/`, `\` or `..` in it make the folder
not-an-app. Malformed optional fields are dropped; unknown top-level fields are kept in `extra`.

```json
{
  "agenta_app": 1,
  "name": "Retro board",
  "icon": "📋",
  "entry": "index.html",
  "template": "agent:retro-board@2",
  "access": "read-write",
  "data": ["data/cards.json", "data/columns.json"],
  "config": "config.json",
  "kit": true,
  "refresh": {
    "prompt": "Re-read the last sprint's notes and refresh data/cards.json"
  },
  "tools": ["drive.search"]
}
```

Defaults: `entry` → `index.html`, `access` → `read`, `kit` → `true`. `refresh` and `tools` are
parsed and typed but unused in v1 (nothing runs the prompt, nothing exposes the tools); they are
in the type so v2 does not need a manifest migration. `template` is stamped by `create_app`
(lane D) and is `null` or absent for hand-written apps.

## API deltas (lane B)

All under the existing mount files endpoints; nothing new is mounted.

- `GET /mounts/{id}/files?read=p` → `{path, content, etag}`.
- List entries gain `etag` (a string for files, `null` for folders).
- `PUT /mounts/{id}/files?path=p` with a raw text body honours `If-Match: <etag>` and
  `If-None-Match: *` (create only). Returns `{path, size, etag}`.
- `DELETE /mounts/{id}/files?path=p` honours `If-Match`.
- Precondition mismatch → `412` with body `{"detail": {"code": "conflict", "etag": <current or null>}}`.
- No precondition header → unconditional, exactly as today. Existing callers do not change.

Frontend transport note: the generated Fern `writeMountFile` sends no body, so the host writes
through the existing axios raw-body path with `Content-Type: text/plain; charset=utf-8` and an
`If-Match` header. Reads, list and delete go through the Fern client; delete passes `If-Match`
via `requestOptions.headers` if the generated method accepts it, otherwise it falls back to axios
too. Either way the 412 body above is what the host maps to `conflict`.

## Platform ops (lane D)

Two ops on the agent's platform tool surface:

- `create_app(starter: str, dir: str, update: bool = False) -> {paths: list[str], template: str}`
  Copies a starter into `dir`. Refuses when `dir/app.json` already exists unless `update=True`;
  with `update`, replaces the non-data files only (everything the manifest's `data` list does not
  name) so the user's content survives a template bump. Stamps `template` in the written
  `app.json` (`board@1`, or `agent:retro-board@2` for an agent-authored starter).
- `list_starters() -> list[{name, version, when, config_keys, data_files, access}]`
  Union of the bundled starters and any `agent-files/.apps/starters/*/SKILL.md` in the mount;
  `when` is the one-line "use this when…" from the SKILL.md front matter.

## Kit (lane E)

The kit is one CSS file the host injects when `kit !== false`. It reads exactly the tokens in
`KIT_TOKENS` and defines exactly the classes in `KIT_CLASSES`:

- Tokens: `--ag-bg`, `--ag-fg`, `--ag-muted`, `--ag-line`, `--ag-accent`, `--ag-accent-soft`,
  `--ag-ok`, `--ag-warn`, `--ag-crit`, `--ag-font`, `--ag-radius`.
- Classes: `.ag-app`, `.ag-toolbar`, `.ag-btn`, `.ag-btn-primary`, `.ag-input`, `.ag-select`,
  `.ag-check`, `.ag-card`, `.ag-columns`, `.ag-column`, `.ag-list`, `.ag-grid`, `.ag-badge`,
  `.ag-empty`, `.ag-toast`.

12px base font size. The kit CSS contains no `url()`, `@import` or `@font-face` — the CSP below
would block them anyway, and the kit must render identically in Storybook and in the drive.

## Sandbox, CSP and feature flag

- `sandbox="allow-scripts allow-forms allow-popups"` (`SANDBOX_FLAGS`). No `allow-same-origin`:
  the app is an opaque origin and only ever reaches the drive through the port.
- CSP (`RUN_CSP`), injected as a `<meta http-equiv>` at the top of the document:
  `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`.
- Feature flag: `userScopedFlagAtom` with key `agent-apps` (`AGENT_APPS_FLAG`). Off means the
  drive shows the folder as plain files.

## Stub globals (lane E)

The stub is inlined into the app document ahead of its own scripts and installs:

```ts
window.agenta = {
    version: 1,
    ready: Promise<void>,          // resolves after hello; fs calls before it queue
    canWrite: boolean,
    dir: string,                   // app dir relative to the mount root
    visible: boolean,
    fs: {
        read(path): Promise<string>,
        readJSON(path): Promise<unknown>,
        write(path, text, opts?: {force?: boolean}): Promise<{path, size, etag}>,
        writeJSON(path, value, opts?: {force?: boolean}): Promise<{path, size, etag}>,
        list(path?): Promise<FileEntry[]>,
        exists(path): Promise<boolean>,
        stat(path): Promise<FileStat>,
        remove(path, opts?: {force?: boolean}): Promise<{deleted: boolean}>,
    },
    addEventListener(type: "visibilitychange" | "changed" | "theme", cb): () => void,
}
```

Failures reject with an `Error` whose `code` is the `BridgeErrorCode` and whose `etag` (on
`conflict`) is the server's current etag. The stub also forwards `window.onerror` as
`ScriptErrorMsg` and intercepts link clicks as `NavMsg`.

## Storybook (lane C)

Stories for the UI live under `web/storybook/stories/entity-ui/htmlApp/` and are titled
`@agenta/entity-ui/Drive/HtmlApp/<Component>`. They run on `createMockHtmlAppHost` — pass
`grant`, `failWith`, `latencyMs` and `externalWrite` to reach the states a reviewer cannot click
into: read-only, conflict, slow drive, agent edit while open, script error.

## Size caps

4 MB per read (`READ_CAP`), 1 MB per write (`WRITE_CAP`); over either → `too_large`. The API
enforces the same numbers, so the host does not need to pre-check, but the mock does so the UI
can be built against the error.
