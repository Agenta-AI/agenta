/**
 * Agent HTML apps — the real bridge host (lane A).
 *
 * Parent-side half of the bridge. `attach(iframe)` posts the `hello` with a fresh `MessagePort`
 * and then serves every `FsRequest` that arrives on that port against the mounts API through
 * {@link createFsClient}. Nothing arriving on `window` is ever read: the port is the only channel.
 *
 * Per request, in this order: validate the shape → resolve scope (before any network) → enforce
 * the grant on write methods → body checks → the API call with the implicit `If-Match` from the
 * etag cache (skipped on `force`). Every result refreshes the cache; a successful write/remove
 * calls `onWrite` so the drive can revalidate. `notifyChanged` leaves the cache alone: a write the
 * app has not merged must conflict, not overwrite the agent's edit. Behaviour matches `createMockHtmlAppHost` rule for
 * rule — the mock's test table runs against this host with a fake client.
 */

import {createEtagCache, type EtagCache} from "./etags"
import {createFsClient, isFsClientError, type FsClient} from "./fsClient"
import {
    isFsRequest,
    isIframeToParent,
    WRITE_METHODS,
    type BridgeError,
    type ChangedMsg,
    type FileEntry,
    type FsFailure,
    type FsMethod,
    type FsRequest,
    type FsResponse,
    type FsResults,
    type Hello,
    type HtmlAppHost,
    type HtmlAppHostError,
    type HtmlAppHostOptions,
    type ParentToIframe,
    type ThemeMsg,
    type VisibilityMsg,
} from "./protocol"
import {isScopeFailure, resolveScoped, SCOPE_MESSAGE, toAppRelative} from "./scope"

export interface HtmlAppHostDeps {
    /** Transport override (tests, Storybook). Defaults to the real mounts client. */
    client?: FsClient
}

/** The real host plus the hooks tests and the mock share. */
export interface HtmlAppBridgeHost extends HtmlAppHost {
    /** Drive the host without an iframe: what the stub would send. */
    handle(req: FsRequest): Promise<FsResponse | FsFailure>
    /** path (relative to dir) → the etag the host last handed to the app (what If-Match carries). */
    etags: EtagCache
    readonly attached: boolean
}

const failure = (id: number, error: BridgeError): FsFailure => ({v: 1, id, ok: false, error})

const success = (id: number, result: unknown, etag?: string | null): FsResponse =>
    etag === undefined ? {v: 1, id, ok: true, result} : {v: 1, id, ok: true, result, etag}

export function createHtmlAppHost(
    opts: HtmlAppHostOptions,
    deps: HtmlAppHostDeps = {},
): HtmlAppBridgeHost {
    const {mountId, projectId, dir, grant} = opts
    const client: FsClient = deps.client ?? createFsClient({mountId, projectId})
    const etags = createEtagCache()

    let visible = opts.visible ?? true
    let tokens: Record<string, string> = {...opts.tokens}

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

    const relativeOf = (fullPath: string): string => toAppRelative(dir, fullPath) ?? fullPath

    const rememberEntries = (entries: FileEntry[]): FileEntry[] =>
        entries.flatMap((entry) => {
            const relative = toAppRelative(dir, entry.path)
            if (relative === null || relative === "") return []
            if (!entry.isFolder && typeof entry.etag === "string") etags.set(relative, entry.etag)
            return [{...entry, path: relative}]
        })

    const serve = async (req: FsRequest): Promise<FsResponse | FsFailure> => {
        const {id, method} = req

        const resolved = resolveScoped(dir, req.path, {allowRoot: method === "list"})
        if (isScopeFailure(resolved)) return failure(id, {code: "scope", message: SCOPE_MESSAGE})
        const full = resolved
        const relative = relativeOf(full)

        if (WRITE_METHODS.has(method) && grant !== "read-write") {
            return failure(id, {code: "read_only", message: "app has read-only access"})
        }

        const ifMatch = req.force === true ? undefined : etags.get(relative)

        switch (method) {
            case "read":
            case "readJSON": {
                const {result, etag} = await client[method](full)
                etags.set(relative, etag)
                return success(id, result, etag)
            }
            case "write":
            case "writeJSON": {
                const body = req.body
                if (typeof body !== "string") {
                    return failure(id, {code: "bad_request", message: "write needs a body"})
                }
                const {result, etag} = await client[method](full, body, {ifMatch})
                const written: FsResults["write"] = {...result, path: relative}
                const next = etag ?? result.etag
                etags.set(relative, next)
                opts.onWrite?.()
                return success(id, written, next)
            }
            case "list": {
                const {result} = await client.list(full)
                return success(id, rememberEntries(result))
            }
            case "exists": {
                const {result} = await client.exists(full)
                return success(id, result)
            }
            case "stat": {
                const {result, etag} = await client.stat(full)
                const next = etag ?? result.etag
                etags.set(relative, next)
                return success(id, {...result, path: relative}, next)
            }
            case "remove": {
                const {result} = await client.remove(full, {ifMatch})
                etags.invalidate([relative])
                opts.onWrite?.()
                return success(id, result)
            }
            default:
                return failure(id, {code: "bad_request", message: `unknown method ${method}`})
        }
    }

    const handle = async (req: FsRequest): Promise<FsResponse | FsFailure> => {
        let res: FsResponse | FsFailure
        try {
            res = await serve(req)
        } catch (error) {
            if (isFsClientError(error)) {
                const bridgeError: BridgeError = {code: error.code, message: error.message}
                if (error.code === "conflict") bridgeError.etag = error.etag ?? null
                res = failure(req.id, bridgeError)
            } else {
                const message = error instanceof Error ? error.message : "the drive is unavailable"
                res = failure(req.id, {code: "unavailable", message})
            }
        }
        if (!res.ok) {
            emitError({
                kind: "bridge",
                message: res.error.message,
                method: req.method as FsMethod,
                path: req.path,
            })
        }
        return res
    }

    const onPortMessage = async (data: unknown, active: MessageChannel) => {
        if (isFsRequest(data)) {
            const res = await handle(data)
            // The iframe may have been detached (or re-attached) while the call was in flight.
            if (channel === active) post(res)
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
        const next = new MessageChannel()
        channel = next
        next.port1.onmessage = (event: MessageEvent) => {
            void onPortMessage(event.data, next)
        }
        const hello: Hello = {
            v: 1,
            type: "hello",
            dir,
            canWrite: grant === "read-write",
            visible,
            tokens,
        }
        target.postMessage(hello, "*", [next.port2])
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

    return {
        etags,
        handle,
        get attached() {
            return channel !== null
        },
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
}
