/**
 * Agent HTML apps — the injected stub (lane A).
 *
 * The host inlines {@link BRIDGE_STUB} into the app document ahead of the app's own scripts. It
 * installs `window.agenta`, waits for the parent's `hello` (a `window` message carrying a
 * transferred `MessagePort`), and from then on serialises every `window.agenta.fs` call to an
 * `FsRequest` on that port. It relies on NOTHING from the parent but the hello.
 *
 * The script is the source of {@link bridgeStub} (`(function(){...})()`), so the same code is
 * unit-tested by evaluating the string in a jsdom window. Hence the constraints inside the
 * function: plain ES2017, no imports, no references to anything outside its own body (a bundler
 * may rename or hoist module-level identifiers; the function body must be self-contained), and no
 * syntax a downlevel pass would rewrite into a shared helper (no spread, no `??`/`?.`).
 */

// Old-style loops on purpose: the body below is shipped as a string into a foreign document.
/* eslint-disable no-var, @typescript-eslint/prefer-for-of */

interface StubPending {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
}

type StubListenerMap = Record<string, ((detail: unknown) => void)[]>

interface StubHelloData {
    type?: unknown
    v?: unknown
    dir?: unknown
    canWrite?: unknown
    visible?: unknown
    tokens?: unknown
}

interface StubPortData {
    v?: unknown
    id?: unknown
    ok?: unknown
    result?: unknown
    error?: {code?: unknown; message?: unknown; etag?: unknown}
    type?: unknown
    visible?: unknown
    paths?: unknown
    tokens?: unknown
}

interface StubError extends Error {
    code?: string
    etag?: string | null
}

/**
 * The stub body. Every reference inside resolves to a local, a browser global, or a literal —
 * keep it that way (see the module comment). The `agenta` object it installs is documented in
 * `docs/design/agent-html-apps/contracts.md` ("Stub globals").
 */
function bridgeStub(): void {
    var VERSION = 1
    var STYLE_ID = "agenta-tokens"
    var MAX_BUFFERED_ERRORS = 20

    // WebRTC is the one network API the CSP does not reach. `default-src 'none'` governs fetch,
    // XHR, WebSocket, beacons and every resource load, but ICE is not a fetch: an app can point
    // `RTCPeerConnection` at a host and port of its choosing and the packets leave. Measured
    // against this exact sandbox and policy, a peer connection gathered a `srflx` candidate (a
    // completed round trip to a public STUN server) and UDP reached a chosen local port. The
    // `webrtc 'block'` CSP directive had no effect in a `<meta>` policy.
    //
    // The stub runs before any app script, so the constructors are gone before the app can hold
    // a reference. The usual recovery — read a clean copy off a nested `about:blank` frame —
    // fails here because the sandbox has no `allow-same-origin`, so the app cannot reach into
    // its own child frames either (verified: `SecurityError`).
    //
    // This is a blocklist entry and should be read as one. It closes a channel that was open; it
    // does not make the folder rule safe, because that still depends on this page getting every
    // path check right. The server-side prefix check is what makes the exit list stop mattering.
    var RTC_GLOBALS = [
        "RTCPeerConnection",
        "webkitRTCPeerConnection",
        "mozRTCPeerConnection",
        "RTCDataChannel",
    ]
    for (var r = 0; r < RTC_GLOBALS.length; r++) {
        try {
            Object.defineProperty(window, RTC_GLOBALS[r], {
                value: undefined,
                configurable: false,
                writable: false,
            })
        } catch (err) {
            try {
                delete (window as unknown as Record<string, unknown>)[RTC_GLOBALS[r]]
            } catch (err2) {
                // Nothing else to try; the channel stays open and the server check is the answer.
            }
        }
    }

    var port: MessagePort | null = null
    var nextId = 0
    var pending: Record<number, StubPending> = {}
    var queue: unknown[] = []
    var bufferedErrors: unknown[] = []
    var listeners: StubListenerMap = {visibilitychange: [], changed: [], theme: []}

    var resolveReady: () => void = function () {}
    var rejectReady: (reason: unknown) => void = function () {}
    var ready = new Promise<void>(function (resolve, reject) {
        resolveReady = resolve
        rejectReady = reject
    })
    // A rejected `ready` nobody awaits must not surface as an unhandled rejection of our own.
    ready.catch(function () {})

    function emit(type: string, detail: unknown): void {
        var list = listeners[type]
        if (!list) return
        var copy = list.slice()
        for (var i = 0; i < copy.length; i++) {
            try {
                copy[i](detail)
            } catch (e) {
                // A listener's failure must not break the others.
            }
        }
    }

    function makeError(code: string, message: string, etag?: string | null): StubError {
        var err: StubError = new Error(message)
        err.code = code
        if (etag !== undefined) err.etag = etag
        return err
    }

    function postOrQueue(msg: unknown): void {
        if (port) port.postMessage(msg)
        else queue.push(msg)
    }

    function send(method: string, path: unknown, body?: string, opts?: {force?: boolean}) {
        return new Promise(function (resolve, reject) {
            var id = ++nextId
            var msg: Record<string, unknown> = {
                v: VERSION,
                id: id,
                method: method,
                path: path === undefined || path === null ? "" : String(path),
            }
            if (typeof body === "string") msg.body = body
            if (opts && opts.force === true) msg.force = true
            pending[id] = {resolve: resolve, reject: reject}
            postOrQueue(msg)
        })
    }

    function cssSafe(value: unknown): string {
        return String(value).replace(/[;{}<>]/g, "")
    }

    function applyTokens(tokens: unknown): void {
        if (!document) return
        var css = ""
        if (tokens && typeof tokens === "object") {
            var names = Object.keys(tokens as Record<string, unknown>)
            for (var i = 0; i < names.length; i++) {
                var name = names[i]
                if (name !== "color-scheme" && !/^--[A-Za-z0-9_-]+$/.test(name)) continue
                css += name + ":" + cssSafe((tokens as Record<string, unknown>)[name]) + ";"
            }
        }
        var head = document.head
        if (!head) {
            head = document.createElement("head")
            document.documentElement.insertBefore(head, document.documentElement.firstChild)
        }
        var style = document.getElementById(STYLE_ID)
        if (!style) {
            style = document.createElement("style")
            style.id = STYLE_ID
            head.insertBefore(style, head.firstChild)
        }
        style.textContent = ":root{" + css + "}"
    }

    function showNotice(text: string): void {
        var render = function () {
            var body = document.body
            if (!body) return
            var el = document.createElement("div")
            el.setAttribute("data-agenta-notice", "")
            el.style.cssText =
                "position:fixed;left:0;right:0;bottom:0;padding:6px 10px;font:12px system-ui,sans-serif;" +
                "background:#fff3cd;color:#664d03;border-top:1px solid #ffe69c;z-index:2147483647"
            el.textContent = text
            body.appendChild(el)
        }
        if (document.body) render()
        else document.addEventListener("DOMContentLoaded", render)
    }

    function onPortMessage(event: MessageEvent): void {
        var data = event.data as StubPortData | null
        if (!data || typeof data !== "object" || data.v !== VERSION) return

        if (typeof data.id === "number") {
            var entry = pending[data.id]
            if (!entry) return
            delete pending[data.id]
            if (data.ok === true) {
                entry.resolve(data.result)
            } else {
                var error = data.error || {}
                entry.reject(
                    makeError(
                        typeof error.code === "string" ? error.code : "unavailable",
                        typeof error.message === "string" ? error.message : "bridge error",
                        "etag" in error ? (error.etag as string | null) : undefined,
                    ),
                )
            }
            return
        }

        if (data.type === "visibility") {
            agenta.visible = data.visible !== false
            emit("visibilitychange", {visible: agenta.visible})
        } else if (data.type === "changed") {
            var paths = Array.isArray(data.paths) ? data.paths.slice() : []
            emit("changed", {paths: paths})
        } else if (data.type === "theme") {
            applyTokens(data.tokens)
            emit("theme", {tokens: data.tokens || {}})
        }
    }

    function adoptPort(next: MessagePort, data: StubHelloData): void {
        if (port && port !== next) {
            try {
                port.close()
            } catch (e) {
                // Already closed.
            }
        }
        port = next
        port.onmessage = onPortMessage
        agenta.canWrite = data.canWrite === true
        agenta.dir = typeof data.dir === "string" ? data.dir : ""
        agenta.visible = data.visible !== false
        applyTokens(data.tokens)
        // Requests parked before the handshake go out in order, then boot-time errors.
        var parked = queue
        queue = []
        for (var i = 0; i < parked.length; i++) port.postMessage(parked[i])
        var errors = bufferedErrors
        bufferedErrors = []
        for (var j = 0; j < errors.length; j++) port.postMessage(errors[j])
        port.postMessage({v: VERSION, type: "hello-ack"})
        resolveReady()
    }

    function onWindowMessage(event: MessageEvent): void {
        var data = event.data as StubHelloData | null
        if (!data || typeof data !== "object" || data.type !== "hello") return
        var ports = event.ports
        var next = ports && ports.length > 0 ? ports[0] : null
        if (!next) return
        if (data.v !== VERSION) {
            var reason =
                "This app was built for a different Agenta bridge (v" +
                String(data.v) +
                "); expected v" +
                VERSION +
                "."
            rejectReady(makeError("unavailable", reason))
            showNotice(reason)
            return
        }
        adoptPort(next, data)
    }

    function reportError(msg: Record<string, unknown>): void {
        msg.v = VERSION
        msg.type = "error"
        if (port) port.postMessage(msg)
        else if (bufferedErrors.length < MAX_BUFFERED_ERRORS) bufferedErrors.push(msg)
    }

    function describe(reason: unknown): string {
        if (reason && typeof reason === "object" && typeof (reason as Error).message === "string") {
            return (reason as Error).message
        }
        return String(reason)
    }

    var fs = {
        read: function (path: string) {
            return send("read", path)
        },
        readJSON: function (path: string) {
            return send("readJSON", path).then(function (result) {
                // A host that serves readJSON as a plain read hands back text; parse it here.
                if (typeof result !== "string") return result
                try {
                    return JSON.parse(result)
                } catch (e) {
                    throw makeError("bad_request", "file is not valid JSON")
                }
            })
        },
        write: function (path: string, text: string, opts?: {force?: boolean}) {
            if (typeof text !== "string") {
                return Promise.reject(makeError("bad_request", "write needs a string body"))
            }
            return send("write", path, text, opts)
        },
        writeJSON: function (path: string, value: unknown, opts?: {force?: boolean}) {
            var body: string | undefined
            try {
                body = JSON.stringify(value)
            } catch (e) {
                return Promise.reject(makeError("bad_request", "value is not serialisable"))
            }
            if (typeof body !== "string") {
                return Promise.reject(makeError("bad_request", "value is not serialisable"))
            }
            return send("writeJSON", path, body, opts)
        },
        list: function (path?: string) {
            return send("list", path === undefined ? "" : path)
        },
        exists: function (path: string) {
            return send("exists", path)
        },
        stat: function (path: string) {
            return send("stat", path)
        },
        remove: function (path: string, opts?: {force?: boolean}) {
            return send("remove", path, undefined, opts)
        },
    }

    var agenta = {
        version: VERSION,
        ready: ready,
        canWrite: false,
        dir: "",
        visible: true,
        fs: fs,
        addEventListener: function (type: string, cb: (detail: unknown) => void) {
            if (!listeners[type]) listeners[type] = []
            listeners[type].push(cb)
            return function () {
                agenta.removeEventListener(type, cb)
            }
        },
        removeEventListener: function (type: string, cb: (detail: unknown) => void) {
            var list = listeners[type]
            if (!list) return
            var index = list.indexOf(cb)
            if (index !== -1) list.splice(index, 1)
        },
    }

    ;(window as unknown as {agenta: unknown}).agenta = agenta

    window.addEventListener("message", onWindowMessage)

    window.addEventListener("error", function (event) {
        var e = event as ErrorEvent
        reportError({
            message: e.message || describe(e.error),
            source: e.filename || undefined,
            line: typeof e.lineno === "number" ? e.lineno : undefined,
            col: typeof e.colno === "number" ? e.colno : undefined,
        })
    })

    window.addEventListener("unhandledrejection", function (event) {
        var reason = (event as PromiseRejectionEvent).reason
        reportError({message: "Unhandled rejection: " + describe(reason)})
    })

    // Internal link clicks become `nav` messages the host routes inside the drive; external links
    // fall through to the browser. A fragment link becomes a hash change on this document: a
    // srcdoc document resolves `#x` against the host app's URL, so the browser's own handling
    // would navigate the frame away (which stops the app) instead of scrolling.
    document.addEventListener(
        "click",
        function (event) {
            var el = event.target as HTMLElement | null
            while (el && el.tagName !== "A") el = el.parentElement
            if (!el) return
            var href = el.getAttribute("href")
            if (!href) return
            if (href.charAt(0) === "#") {
                event.preventDefault()
                location.hash = href
                return
            }
            if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.indexOf("//") === 0) return
            event.preventDefault()
            if (port) port.postMessage({v: VERSION, type: "nav", href: href})
        },
        true,
    )
}

/** The script to inline into the app document, ahead of its own scripts. */
export function buildBridgeStub(): string {
    return `(${bridgeStub.toString()})()`
}

export const BRIDGE_STUB: string = buildBridgeStub()
