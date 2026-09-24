/**
 * Agent HTML apps — bridge protocol (lane 0 contract).
 *
 * An HTML app is a folder in an agent drive with an `app.json` manifest and an `index.html`. The
 * host renders `index.html` in a sandboxed iframe and hands it a `MessagePort`; the app talks to
 * its own folder through `window.agenta.fs` (the stub) which serialises to the messages below.
 *
 * Every message carries `v: 1` so a future breaking change can be negotiated. Requests carry an
 * `id` the response echoes. Nothing in this file has runtime behaviour beyond three type guards;
 * lane A (host) and lane C (UI) both import it so a mismatch fails in `tsc`.
 */

export const BRIDGE_VERSION = 1 as const
/** Largest file the bridge will serve, in bytes. Larger reads fail with `too_large`. */
export const READ_CAP = 4 * 1024 * 1024
/** Largest body the bridge will accept, in bytes. Larger writes fail with `too_large`. */
export const WRITE_CAP = 1 * 1024 * 1024

/**
 * Error codes the host returns. They map 1:1 onto the API deltas lane B implements:
 * `scope` (path leaves the app dir), `read_only` (grant is `read`), `not_found` (404),
 * `conflict` (412 — If-Match mismatch), `too_large` (413 / caps above), `unavailable` (host
 * detached or network down), `bad_request` (malformed request or non-JSON body).
 */
export type BridgeErrorCode =
    | "scope"
    | "read_only"
    | "not_found"
    | "conflict"
    | "too_large"
    | "unavailable"
    | "bad_request"

export interface BridgeError {
    code: BridgeErrorCode
    message: string
    /** On `conflict`: the etag the server currently holds (null when the file is gone). */
    etag?: string | null
}

/** The eight methods on `window.agenta.fs`. */
export type FsMethod =
    | "read"
    | "readJSON"
    | "write"
    | "writeJSON"
    | "list"
    | "exists"
    | "stat"
    | "remove"

/** Access the manifest asks for; the host may narrow it (never widen). */
export type GrantLevel = "read" | "read-write"

export interface FileStat {
    /** Path relative to the app dir, `/`-separated, no leading slash. */
    path: string
    size: number
    /** Epoch millis, or null when the backend does not report one. */
    mtime: number | null
    /** Content etag; null/absent for folders. */
    etag?: string | null
}

export interface FileEntry extends FileStat {
    isFolder: boolean
}

// ---------------------------------------------------------------------------------------------
// iframe → parent
// ---------------------------------------------------------------------------------------------

/** A file-system call from the stub. `body` is the serialised text for write/writeJSON. */
export interface FsRequest {
    v: 1
    id: number
    method: FsMethod
    path: string
    body?: string
    /** Skip the implicit If-Match on write/remove (overwrite whatever is there). */
    force?: boolean
}

/** The stub acknowledges the `hello` once it has installed `window.agenta`. */
export interface HelloAck {
    v: 1
    type: "hello-ack"
}

/** The app asked to navigate (a clicked link); the host decides what to do with it. */
export interface NavMsg {
    v: 1
    type: "nav"
    href: string
}

/** An uncaught script error inside the iframe, forwarded so the host can surface it. */
export interface ScriptErrorMsg {
    v: 1
    type: "error"
    message: string
    source?: string
    line?: number
    col?: number
}

export type IframeToParent = FsRequest | HelloAck | NavMsg | ScriptErrorMsg

// ---------------------------------------------------------------------------------------------
// parent → iframe
// ---------------------------------------------------------------------------------------------

/**
 * First message, sent with `window.postMessage` and the `MessagePort` transferred. Everything
 * after it travels over the port.
 */
export interface Hello {
    v: 1
    type: "hello"
    /** App dir relative to the mount root (what `window.agenta.dir` reports). */
    dir: string
    canWrite: boolean
    visible: boolean
    /** Kit theme tokens (`--ag-*` → value). */
    tokens: Record<string, string>
}

export interface FsResponse {
    v: 1
    id: number
    ok: true
    /** Shape depends on the method — see {@link FsResults}. */
    result: unknown
    /** Etag of the path after this call (read/stat/write); the stub caches it for If-Match. */
    etag?: string | null
}

export interface FsFailure {
    v: 1
    id: number
    ok: false
    error: BridgeError
}

export interface VisibilityMsg {
    v: 1
    type: "visibility"
    visible: boolean
}

/** Paths (relative to the app dir) that changed outside the app, e.g. the agent wrote them. */
export interface ChangedMsg {
    v: 1
    type: "changed"
    paths: string[]
}

export interface ThemeMsg {
    v: 1
    type: "theme"
    tokens: Record<string, string>
}

export type ParentToIframe = Hello | FsResponse | FsFailure | VisibilityMsg | ChangedMsg | ThemeMsg

/** What `FsResponse.result` holds, per method. */
export interface FsResults {
    read: string
    readJSON: unknown
    write: {path: string; size: number; etag?: string | null}
    writeJSON: {path: string; size: number; etag?: string | null}
    list: FileEntry[]
    exists: boolean
    stat: FileStat
    remove: {deleted: boolean}
}

/** Methods that need the `read-write` grant. */
export const WRITE_METHODS: ReadonlySet<FsMethod> = new Set<FsMethod>([
    "write",
    "writeJSON",
    "remove",
])

/**
 * `sandbox` attribute of the app iframe. No `allow-same-origin`: the app is a foreign origin.
 *
 * No `allow-popups` either, and that one is load-bearing. CSP fetch directives do not govern
 * NAVIGATION, and `navigate-to` never shipped in browsers — so with popups allowed, an app can
 * call `window.open("https://…?d=" + data)` inside any click it already receives, and close the
 * window straight after. Verified against these exact flags: the request leaves and the data
 * arrives. `default-src 'none'` stops fetch, XHR, WebSocket and image beacons; it does nothing
 * about a popup. Dropping the flag is what actually closes the app's last way out.
 *
 * An app that wants to link somewhere external still can: the click arrives at the host as a
 * `nav` message and the host decides, which also means the person sees where they are going.
 */
export const SANDBOX_FLAGS = "allow-scripts allow-forms"

/**
 * CSP injected into the app document. Inline code plus anything served over `https:`: scripts,
 * stylesheets, fonts, images and `fetch`/XHR.
 *
 * The network is open on purpose. An app is written by the same agent that can already read its
 * folder and, under the default sandbox network policy, send it anywhere, and apps ship inside
 * templates the person already chose to trust. Blocking egress here protected nothing the agent
 * could not do itself, and it broke ordinary apps that load a library from a CDN. What stays
 * closed is what keeps the app from acting as the person: no `allow-same-origin` (the app is a
 * foreign origin with no Agenta session), the folder-scoped bridge, and the navigation guards
 * (no popups, `form-action 'none'`, the wrapper's `frame-src 'none'`) that keep the app in its
 * frame and the bridge port out of a foreign page.
 *
 * `form-action 'none'` does not inherit from `default-src`, so it has to be named.
 */
export const RUN_CSP =
    "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src https:; form-action 'none'"

/**
 * CSP injected into the PREVIEW document (ordinary drive HTML, not an app).
 *
 * Preview strips every agent script and renders with `allow-popups`, and for a while the first
 * half was taken as the reason the second half was safe. It is not. The stripper clears
 * `iframe[srcdoc]` but nothing stopped `<iframe src="data:text/html,…">`: the nested context
 * inherits `allow-scripts`, its script runs, and with no policy in the document it could `fetch`
 * anywhere. Verified against these exact flags — the request arrived at a listening server with
 * its query string intact.
 *
 * So the fix is a policy rather than another element on a strip list. `object-src`/`frame-src`
 * close the nested contexts (`<object data="data:…">` and `<embed>` execute the same way), and
 * `default-src 'none'` covers `connect-src`, so even a context that somehow runs has no way out.
 * Enumerating vectors does not terminate; denying the capability does.
 *
 * Narrower than {@link RUN_CSP} in one respect, deliberately: Preview strips scripts and allows
 * no `connect-src`. Like Run, it leaves external URLs alone
 * (`inlineAssets` only folds in same-mount assets), so ordinary drive HTML that links a remote
 * stylesheet, image or font renders today and must keep rendering. Those are fetches the policy
 * still confines to their element type; `connect-src` stays denied.
 */
export const PREVIEW_CSP =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; form-action 'none'; frame-src 'none'; object-src 'none'"

/** Theme tokens the kit CSS consumes; the host fills them from its palette. */
export const KIT_TOKENS = [
    "--ag-bg",
    "--ag-fg",
    "--ag-muted",
    "--ag-line",
    "--ag-accent",
    "--ag-accent-soft",
    "--ag-ok",
    "--ag-warn",
    "--ag-crit",
    "--ag-font",
    "--ag-radius",
] as const

/** Classes the kit CSS defines; the starter templates build on these only. */
export const KIT_CLASSES = [
    ".ag-app",
    ".ag-toolbar",
    ".ag-btn",
    ".ag-btn-primary",
    ".ag-input",
    ".ag-select",
    ".ag-check",
    ".ag-card",
    ".ag-columns",
    ".ag-column",
    ".ag-list",
    ".ag-grid",
    ".ag-badge",
    ".ag-empty",
    ".ag-toast",
] as const

export type KitToken = (typeof KIT_TOKENS)[number]

/** `userScopedFlagAtom` key that gates the whole feature. */
export const AGENT_APPS_FLAG = "agent-apps" as const

// ---------------------------------------------------------------------------------------------
// Host interface (lane A implements, lane C calls)
// ---------------------------------------------------------------------------------------------

export interface HtmlAppHostError {
    /** `bridge`: an fs call failed; `script`: the iframe reported an uncaught error. */
    kind: "bridge" | "script"
    message: string
    method?: FsMethod
    path?: string
    line?: number
}

export interface HtmlAppHost {
    /** Bind to a mounted iframe: sends `hello` with a fresh port and starts serving requests. */
    attach(iframe: HTMLIFrameElement): void
    /** Close the port; further fs calls from the app fail with `unavailable`. */
    detach(): void
    setVisible(visible: boolean): void
    setTheme(tokens: Record<string, string>): void
    /** Tell the app some of its files changed underneath it (agent write, drive upload). */
    notifyChanged(paths: string[]): void
    /** Subscribe to errors; returns the unsubscribe. */
    onError(cb: (e: HtmlAppHostError) => void): () => void
    /** Subscribe to navigation requests; returns the unsubscribe. */
    onNav(cb: (href: string) => void): () => void
    /** Subscribe to `changed` paths (app-relative) as the host sends them; returns the unsubscribe. */
    onChanged?(cb: (paths: string[]) => void): () => void
}

export interface HtmlAppHostOptions {
    mountId: string
    projectId: string
    /** App dir relative to the mount root. */
    dir: string
    grant: GrantLevel
    tokens: Record<string, string>
    visible?: boolean
    /** Called after every successful write/remove so the drive can revalidate. */
    onWrite?: () => void
}

// ---------------------------------------------------------------------------------------------
// Type guards (dependency-free)
// ---------------------------------------------------------------------------------------------

const FS_METHODS: ReadonlySet<string> = new Set<FsMethod>([
    "read",
    "readJSON",
    "write",
    "writeJSON",
    "list",
    "exists",
    "stat",
    "remove",
])

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null

const isV1 = (x: unknown): x is Record<string, unknown> => isRecord(x) && x.v === BRIDGE_VERSION

export function isFsRequest(x: unknown): x is FsRequest {
    return (
        isV1(x) &&
        typeof x.id === "number" &&
        typeof x.method === "string" &&
        FS_METHODS.has(x.method) &&
        typeof x.path === "string"
    )
}

export function isIframeToParent(x: unknown): x is IframeToParent {
    if (!isV1(x)) return false
    if (isFsRequest(x)) return true
    switch (x.type) {
        case "hello-ack":
            return true
        case "nav":
            return typeof x.href === "string"
        case "error":
            return typeof x.message === "string"
        default:
            return false
    }
}
