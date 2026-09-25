/**
 * Agent HTML apps — in-memory mock host (lane 0 reference implementation).
 *
 * This is the behavioural spec lane A's real host must match and the fixture lane C's Storybook
 * stories and tests run against. Files live in a `Map`; etags are a content hash; the implicit
 * If-Match rule is exactly the one the real host applies:
 *
 *   the host remembers the etag it last returned for a path (read/list/stat/write) and sends it
 *   as If-Match on the next write/remove of that path; `force: true` skips it; a mismatch is a
 *   `conflict` carrying the etag the server holds now.
 *
 * `handle()` drives the host without an iframe. `attach()` is the real MessageChannel path and is
 * guarded so importing this module in node never touches DOM globals at import time.
 */

import {
    isFsRequest,
    isIframeToParent,
    READ_CAP,
    WRITE_CAP,
    WRITE_METHODS,
    type BridgeError,
    type BridgeErrorCode,
    type ChangedMsg,
    type FileEntry,
    type FileStat,
    type FsFailure,
    type FsMethod,
    type FsRequest,
    type FsResponse,
    type FsResults,
    type GrantLevel,
    type Hello,
    type HtmlAppHost,
    type HtmlAppHostError,
    type ParentToIframe,
    type ThemeMsg,
    type VisibilityMsg,
} from "./protocol"
// The scope rule is production's; the mock shares it so both enforce exactly the same paths.
import {normalizeAppPath} from "./scope"

export interface MockHtmlAppHostOptions {
    grant?: GrantLevel
    dir?: string
    latencyMs?: number
    visible?: boolean
    /** Force a given error code for a method, regardless of the request. */
    failWith?: Partial<Record<FsMethod, BridgeErrorCode>>
    tokens?: Record<string, string>
}

export interface MockHtmlAppHost extends HtmlAppHost {
    /** path (relative to dir) → text */
    files: Map<string, string>
    /** path → the etag the host last handed to the app (what If-Match would carry). */
    etags: Map<string, string>
    log: FsRequest[]
    /** Drive the host without an iframe: what the stub would send. */
    handle(req: FsRequest): Promise<FsResponse | FsFailure>
    /**
     * Simulate an out-of-band write (e.g. the agent): the content changes, the cached etag does
     * not, so the next If-Match mismatches. `changed` fires unless `silent`.
     */
    externalWrite(path: string, text: string, opts?: {silent?: boolean}): void
    /** What the stub posts when the app clicks a link. */
    emitNav(href: string): void
    /** What the stub posts on an uncaught error (or any host error a story needs to show). */
    emitError(e: HtmlAppHostError): void
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** FNV-1a 32-bit over UTF-16 code units, as 8 hex chars. Cheap, stable, good enough for a mock. */
export function computeEtag(text: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, "0")
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length

const failure = (id: number, error: BridgeError): FsFailure => ({v: 1, id, ok: false, error})

const success = <M extends FsMethod>(
    id: number,
    result: FsResults[M],
    etag?: string | null,
): FsResponse =>
    etag === undefined ? {v: 1, id, ok: true, result} : {v: 1, id, ok: true, result, etag}

const FORCED_MESSAGES: Record<BridgeErrorCode, string> = {
    scope: "path is outside the app directory",
    read_only: "app has read-only access",
    not_found: "no such file",
    conflict: "file changed since it was last read",
    too_large: "payload exceeds the size cap",
    unavailable: "host is not attached",
    bad_request: "malformed request",
}

// ---------------------------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------------------------

export function createMockHtmlAppHost(
    initialFiles: Record<string, string>,
    opts: MockHtmlAppHostOptions = {},
): MockHtmlAppHost {
    const grant: GrantLevel = opts.grant ?? "read"
    const dir = opts.dir ?? "app"
    const latencyMs = opts.latencyMs ?? 0
    const failWith = opts.failWith ?? {}

    const files = new Map<string, string>()
    const mtimes = new Map<string, number>()
    const etags = new Map<string, string>()
    const log: FsRequest[] = []

    for (const [rawPath, text] of Object.entries(initialFiles)) {
        const path = normalizeAppPath(rawPath)
        if (path === null) throw new Error(`createMockHtmlAppHost: bad seed path "${rawPath}"`)
        files.set(path, text)
        mtimes.set(path, Date.now())
    }

    let visible = opts.visible ?? true
    let tokens: Record<string, string> = {...(opts.tokens ?? {})}

    const errorCbs = new Set<(e: HtmlAppHostError) => void>()
    const navCbs = new Set<(href: string) => void>()
    const changedCbs = new Set<(paths: string[]) => void>()

    let channel: MessageChannel | null = null
    /** `changed` paths queued while no iframe is attached; flushed right after `hello`. */
    let pendingChanged: string[] = []

    const emitError = (e: HtmlAppHostError) => {
        for (const cb of errorCbs) cb(e)
    }

    const post = (msg: ParentToIframe) => {
        channel?.port1.postMessage(msg)
    }

    const currentEtag = (path: string): string | null => {
        const text = files.get(path)
        return text === undefined ? null : computeEtag(text)
    }

    const statOf = (path: string): FileStat => {
        const text = files.get(path) ?? ""
        return {
            path,
            size: byteLength(text),
            mtime: mtimes.get(path) ?? null,
            etag: computeEtag(text),
        }
    }

    const remember = (path: string, etag: string) => {
        etags.set(path, etag)
    }

    /** The implicit If-Match: null when the write may proceed, else the conflict failure. */
    const checkIfMatch = (req: FsRequest, path: string): FsFailure | null => {
        if (req.force === true) return null
        const seen = etags.get(path)
        if (seen === undefined) return null
        const now = currentEtag(path)
        if (seen === now) return null
        return failure(req.id, {
            code: "conflict",
            message: FORCED_MESSAGES.conflict,
            etag: now,
        })
    }

    const listFolder = (folder: string): FileEntry[] => {
        const prefix = folder === "" ? "" : `${folder}/`
        const seenFolders = new Set<string>()
        const entries: FileEntry[] = []
        for (const key of [...files.keys()].sort()) {
            if (!key.startsWith(prefix)) continue
            const rest = key.slice(prefix.length)
            const slash = rest.indexOf("/")
            if (slash === -1) {
                const stat = statOf(key)
                remember(key, stat.etag as string)
                entries.push({...stat, isFolder: false})
            } else {
                const name = rest.slice(0, slash)
                if (seenFolders.has(name)) continue
                seenFolders.add(name)
                entries.push({
                    path: `${prefix}${name}`,
                    size: 0,
                    mtime: null,
                    etag: null,
                    isFolder: true,
                })
            }
        }
        return entries
    }

    const serve = (req: FsRequest): FsResponse | FsFailure => {
        const {id, method} = req
        const forced = failWith[method]
        if (forced) return failure(id, {code: forced, message: FORCED_MESSAGES[forced]})

        const path = normalizeAppPath(req.path, {allowRoot: method === "list"})
        if (path === null) return failure(id, {code: "scope", message: FORCED_MESSAGES.scope})

        if (WRITE_METHODS.has(method) && grant !== "read-write") {
            return failure(id, {code: "read_only", message: FORCED_MESSAGES.read_only})
        }

        switch (method) {
            case "read":
            case "readJSON": {
                const text = files.get(path)
                if (text === undefined) {
                    return failure(id, {code: "not_found", message: FORCED_MESSAGES.not_found})
                }
                if (byteLength(text) > READ_CAP) {
                    return failure(id, {code: "too_large", message: FORCED_MESSAGES.too_large})
                }
                const etag = computeEtag(text)
                remember(path, etag)
                if (method === "read") return success<"read">(id, text, etag)
                try {
                    return success<"readJSON">(id, JSON.parse(text), etag)
                } catch {
                    return failure(id, {code: "bad_request", message: "file is not valid JSON"})
                }
            }
            case "write":
            case "writeJSON": {
                const body = req.body
                if (typeof body !== "string") {
                    return failure(id, {code: "bad_request", message: "write needs a body"})
                }
                if (method === "writeJSON") {
                    try {
                        JSON.parse(body)
                    } catch {
                        return failure(id, {code: "bad_request", message: "body is not valid JSON"})
                    }
                }
                const size = byteLength(body)
                if (size > WRITE_CAP) {
                    return failure(id, {code: "too_large", message: FORCED_MESSAGES.too_large})
                }
                const conflict = checkIfMatch(req, path)
                if (conflict) return conflict
                files.set(path, body)
                mtimes.set(path, Date.now())
                const etag = computeEtag(body)
                remember(path, etag)
                return success<"write">(id, {path, size, etag}, etag)
            }
            case "list":
                return success<"list">(id, listFolder(path))
            case "exists":
                return success<"exists">(id, files.has(path) || listFolder(path).length > 0)
            case "stat": {
                if (!files.has(path)) {
                    return failure(id, {code: "not_found", message: FORCED_MESSAGES.not_found})
                }
                const stat = statOf(path)
                remember(path, stat.etag as string)
                return success<"stat">(id, stat, stat.etag)
            }
            case "remove": {
                if (!files.has(path)) {
                    return failure(id, {code: "not_found", message: FORCED_MESSAGES.not_found})
                }
                const conflict = checkIfMatch(req, path)
                if (conflict) return conflict
                files.delete(path)
                mtimes.delete(path)
                etags.delete(path)
                return success<"remove">(id, {deleted: true})
            }
            default:
                return failure(id, {code: "bad_request", message: `unknown method ${method}`})
        }
    }

    const handle = async (req: FsRequest): Promise<FsResponse | FsFailure> => {
        log.push(req)
        if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs))
        const res = serve(req)
        if (!res.ok) {
            emitError({
                kind: "bridge",
                message: res.error.message,
                method: req.method,
                path: req.path,
            })
        }
        return res
    }

    const onPortMessage = async (data: unknown) => {
        if (isFsRequest(data)) {
            post(await handle(data))
            return
        }
        if (!isIframeToParent(data) || !("type" in data)) return
        if (data.type === "nav") {
            for (const cb of navCbs) cb(data.href)
        } else if (data.type === "error") {
            emitError({kind: "script", message: data.message, line: data.line})
        }
        // `hello-ack` needs no reply.
    }

    const detach = () => {
        if (!channel) return
        channel.port1.onmessage = null
        channel.port1.close()
        channel = null
    }

    const attach = (iframe: HTMLIFrameElement) => {
        detach()
        if (typeof MessageChannel === "undefined") return
        const target = iframe.contentWindow
        if (!target) return
        channel = new MessageChannel()
        channel.port1.onmessage = (event: MessageEvent) => {
            void onPortMessage(event.data)
        }
        const hello: Hello = {
            v: 1,
            type: "hello",
            dir,
            canWrite: grant === "read-write",
            visible,
            tokens,
        }
        target.postMessage(hello, "*", [channel.port2])
        if (pendingChanged.length > 0) {
            const msg: ChangedMsg = {v: 1, type: "changed", paths: pendingChanged}
            pendingChanged = []
            post(msg)
        }
    }

    const notifyChanged = (paths: string[]) => {
        if (paths.length === 0) return
        for (const cb of changedCbs) cb(paths)
        if (!channel) {
            pendingChanged.push(...paths)
            return
        }
        const msg: ChangedMsg = {v: 1, type: "changed", paths}
        post(msg)
    }

    const host: MockHtmlAppHost = {
        files,
        etags,
        log,
        handle,
        externalWrite(rawPath, text, writeOpts) {
            const path = normalizeAppPath(rawPath)
            if (path === null) throw new Error(`externalWrite: bad path "${rawPath}"`)
            files.set(path, text)
            mtimes.set(path, Date.now())
            // The app's cached etag is left alone on purpose: that is what makes the next
            // write/remove conflict.
            if (!writeOpts?.silent) notifyChanged([path])
        },
        emitNav(href) {
            for (const cb of navCbs) cb(href)
        },
        emitError,
        attach,
        detach,
        setVisible(next) {
            visible = next
            const msg: VisibilityMsg = {v: 1, type: "visibility", visible: next}
            post(msg)
        },
        setTheme(next) {
            tokens = {...next}
            const msg: ThemeMsg = {v: 1, type: "theme", tokens}
            post(msg)
        },
        notifyChanged,
        onError(cb) {
            errorCbs.add(cb)
            return () => {
                errorCbs.delete(cb)
            }
        },
        onNav(cb) {
            navCbs.add(cb)
            return () => {
                navCbs.delete(cb)
            }
        },
        onChanged(cb) {
            changedCbs.add(cb)
            return () => {
                changedCbs.delete(cb)
            }
        },
    }

    return host
}
