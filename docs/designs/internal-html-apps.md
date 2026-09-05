# Internal HTML apps in the workspace

> AGENT-GENERATED, low weight. Draft for technical discussion. This document does not commit us to a roadmap or implementation.

## Context

Agents can already create HTML files in the workspace, and Agenta can preview those files. Today the preview is intentionally static. The renderer removes author-provided scripts, inline event handlers, `javascript:` URLs, and nested `srcdoc` content before loading the page in a sandboxed iframe.

That behavior is correct for an untrusted preview, but it prevents a useful product loop:

1. An agent writes a small application as HTML, CSS, and JavaScript.
2. A user opens and uses the application inside Agenta.
3. The application reads and updates files in the same workspace.
4. The agent can inspect or update those same files later.

A concrete example is a todo board. The agent creates `todo.html` and `board.json`. The user moves a card in the embedded application, which updates `board.json`. The agent can read the updated file during the next turn.

The proposal is to add this as an explicit **Run** mode. Preview remains static and safe by default.

## Current behavior

`HtmlBody` in `web/packages/agenta-entity-ui/src/drive/renderers.tsx` already does most of the browser-side work:

- It reads an HTML file from a mount.
- It inlines relative images and styles.
- It renders the result through `iframe.srcdoc`.
- It uses a sandbox that allows scripts but does not include `allow-same-origin`.
- It accepts navigation messages only from the iframe it created.

The assembler then removes all author-provided JavaScript. Only Agenta's navigation interceptor runs inside the iframe.

This means the renderer already provides an isolation boundary and a parent-to-iframe message path. The missing piece is a deliberately small capability bridge for workspace files.

## Proposed user experience

HTML files get three views:

- **Preview** renders sanitized HTML exactly as it does today.
- **Source** shows the file contents exactly as it does today.
- **Run** executes the file as a small internal application.

The first time a user selects Run, Agenta explains what the application can access and asks for a scope:

- Read files in this folder.
- Read and write files in this folder.
- Cancel.

The iframe shows the active access level. A Refresh action reloads the application from the current workspace files. File watching and automatic reload are not required for the first version.

Preview must stay the default. Opening an HTML attachment must never execute its scripts without an explicit user action.

## Proposed browser contract

Agenta injects `window.arg` as the first script in the Run document:

```ts
window.arg = {
  version: 1,
  canWrite: true,
  scope: "folder",
  workspaceId: "...",
  dir: "/apps",
  ready: Promise<ArgContext>,
  fs: {
    read(path): Promise<string>,
    readJSON(path): Promise<unknown>,
    write(path, text): Promise<{ path: string; size: number }>,
    writeJSON(path, value): Promise<{ path: string; size: number }>,
    list(path?): Promise<FileEntry[]>,
    exists(path): Promise<boolean>,
    remove(path): Promise<{ deleted: boolean }>
  }
}
```

The object contains no API token. Each method sends a request to the parent window through `postMessage`. The parent validates the message source, resolves the path, checks the grant, calls the workspace file API, and sends back a result or a structured error.

The application code stays simple:

```js
await window.arg.ready

const board = await window.arg.fs.readJSON("board.json")
board.columns[0].cards.push({ id: crypto.randomUUID(), text: "Review the idea" })
await window.arg.fs.writeJSON("board.json", board)
```

This resembles a small client library backed by remote procedure calls. The iframe receives a constrained API, not direct access to Agenta's authenticated HTTP client.

## Request flow

```text
todo.html inside sandbox
        |
        | postMessage({ method: "read", args: ["board.json"] })
        v
HtmlBody parent handler
        |
        | validate source, scope, path, and access
        v
existing mounts client
        |
        | authenticated request with project and mount context
        v
workspace file
```

For every incoming request, the parent must check that `event.source` is the current iframe. It must ignore messages with an unknown protocol marker or method.

## Security model

The design relies on five boundaries.

### Explicit execution

Preview continues to strip scripts. Run is a separate user action with a clear access prompt.

### Opaque iframe origin

The Run iframe keeps the existing sandbox and does not add `allow-same-origin`. The application cannot read the parent document, cookies, local storage, or JavaScript objects.

The exact sandbox flags need a security review. The initial candidate is the existing set: `allow-scripts allow-popups allow-popups-to-escape-sandbox`. We should question whether Run needs either popup capability.

### No credential delegation

The bridge never exposes a session cookie, bearer token, API key, authenticated Axios instance, or raw arbitrary-fetch method. The parent performs approved operations on the application's behalf.

### Scoped paths

Relative paths resolve from the HTML file's directory. Under folder scope, the parent normalizes paths and rejects traversal outside that directory. A path such as `../../secrets.txt` must fail before any network request.

The browser check improves feedback, but the server remains the final authorization boundary.

### Narrow methods

The first version supports only file operations. It does not expose arbitrary network calls, shell execution, workspace metadata, secrets, agent invocation, or other browser capabilities.

## Mapping to Agenta

The bridge should live next to the renderer as a small module, for example `web/packages/agenta-entity-ui/src/drive/argBridge.ts`.

The parent handler can reuse the mount and project context already available to `HtmlBody`. New frontend API code should follow the current frontend rule and use the generated Fern client when the mounts resource supports the required operations. Existing binary download code uses Axios because Fern JSON parsing cannot preserve bytes; that exception does not automatically apply to new text file methods.

The initial mapping is:

| Bridge method | Workspace operation |
| --- | --- |
| `read` | Read one UTF-8 file and return its text |
| `list` | List entries under a scoped folder |
| `exists` | Resolve existence without exposing an unscoped listing |
| `write` | Write one UTF-8 file after checking write access |
| `remove` | Delete one scoped file after checking write access |

We should confirm the generated mounts client and backend endpoints before choosing exact functions. The contract above is the proposal. It is not a claim that every endpoint already has the required shape.

## Prototype evidence

A standalone prototype exercised the proposed bridge with a todo application and a mount-shaped in-memory store.

The logic verification covered ten behaviors:

- The hello/context handshake resolves `window.arg.ready`.
- Reading and parsing JSON crosses the message bridge.
- Listing and existence checks return file metadata.
- A write persists into the shared file store.
- Missing files return a stable `not_found` code.
- Read-only mode rejects write and remove with `read_only`.
- An out-of-band agent edit appears after the application reloads.
- Remove works when write access is enabled.

A separate static check confirmed that the bridge is injected before application code and that the iframe sandbox omits `allow-same-origin`.

These checks reduce uncertainty in the browser protocol. They do not replace testing against the real mounts API, a browser security review, or recorded quality assurance in a deployed Agenta build.

## Suggested implementation slices

### Slice 1: read-only experiment

Add Run mode behind a feature flag. Support `read`, `readJSON`, `list`, and `exists` within the HTML file's folder. Keep the implementation read-only while reviewing the execution and path boundaries.

### Slice 2: explicit write access

Add `write`, `writeJSON`, and `remove` after confirming both frontend and backend authorization. Show the active grant in the Run interface.

### Slice 3: usability

Add starter templates, error presentation, and optional refresh cues based on real usage. Do not add a broad application platform before we know which internal apps users create.

## Questions for Arda

1. Is `HtmlBody` the right ownership boundary, or should executable HTML use a separate renderer?
2. Should the first implementation remain read-only, or is explicit folder-scoped write access small enough to include?
3. Which mounts client methods should back text read, list, write, and remove?
4. Should grants live only for the open view, for the browser session, or as workspace metadata?
5. Should the application be allowed to load external scripts, images, or styles?
6. Do we need popups in Run mode, or can we tighten the current iframe flags?
7. What server-side check guarantees that folder scope cannot be bypassed by path normalization differences?
8. Is `window.arg` the right public name and versioning surface if generated applications start depending on it?

## Recommendation

Start with a separate, feature-flagged Run mode and folder-scoped read access. Keep Preview unchanged. Treat the bridge as a versioned product API even in the experiment, because generated HTML will quickly depend on its behavior.

After the read-only path works against a real mount, review the iframe flags and path resolution with Arda before enabling writes. This keeps the first engineering slice small while preserving the useful end state.
