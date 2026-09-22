// @vitest-environment jsdom
/**
 * The injected stub, evaluated in a FRESH jsdom realm per test (an iframe's contentWindow) so
 * each test gets its own `window.agenta`, its own listeners and a clean document. The "parent"
 * side is a Node `MessageChannel`: `port2` rides on a synthetic `message` event into the realm,
 * `port1` is what the test reads and writes, exactly as the host does.
 */
import {afterEach, describe, expect, it} from "vitest"

import type {FsRequest, IframeToParent, ParentToIframe} from "../../src/drive/htmlApp/protocol"
import {BRIDGE_STUB, buildBridgeStub} from "../../src/drive/htmlApp/stub"

interface StubAgenta {
    version: number
    ready: Promise<void>
    canWrite: boolean
    dir: string
    visible: boolean
    fs: Record<string, (...args: unknown[]) => Promise<unknown>>
    addEventListener(type: string, cb: (detail: unknown) => void): () => void
    removeEventListener(type: string, cb: (detail: unknown) => void): void
}

interface Realm {
    win: Window & {agenta: StubAgenta; eval(code: string): unknown}
    doc: Document
    agenta: StubAgenta
}

const frames: HTMLIFrameElement[] = []
const channels: MessageChannel[] = []

const realm = (): Realm => {
    const frame = document.createElement("iframe")
    document.body.appendChild(frame)
    frames.push(frame)
    const win = frame.contentWindow as Realm["win"]
    win.eval(BRIDGE_STUB)
    return {win, doc: win.document, agenta: win.agenta}
}

/** Post a message into the realm's window the way `iframe.contentWindow.postMessage` lands. */
const postToWindow = (r: Realm, data: unknown, ports: MessagePort[] = []) => {
    const event = new r.win.Event("message") as Event & {data: unknown; ports: MessagePort[]}
    event.data = data
    event.ports = ports
    r.win.dispatchEvent(event)
}

/** A parent-side port that records everything the stub sends, plus a helper to await messages. */
const parentPort = () => {
    const channel = new MessageChannel()
    channels.push(channel)
    /** Everything the stub ever sent (for "nothing arrived" assertions). */
    const received: IframeToParent[] = []
    /** Messages not yet consumed by `next()`. */
    const unread: IframeToParent[] = []
    const waiters: ((msg: IframeToParent) => void)[] = []
    channel.port1.onmessage = (event: MessageEvent) => {
        const msg = event.data as IframeToParent
        received.push(msg)
        const waiter = waiters.shift()
        if (waiter) waiter(msg)
        else unread.push(msg)
    }
    const next = () =>
        new Promise<IframeToParent>((resolve) => {
            const pending = unread.shift()
            if (pending) resolve(pending)
            else waiters.push(resolve)
        })
    const send = (msg: ParentToIframe) => channel.port1.postMessage(msg)
    return {channel, received, next, send, port2: channel.port2}
}

const hello = (overrides: Partial<Record<string, unknown>> = {}) => ({
    v: 1,
    type: "hello",
    dir: "apps/board",
    canWrite: true,
    visible: true,
    tokens: {"--ag-bg": "#fff", "--ag-fg": "#111"},
    ...overrides,
})

/** Realm + completed handshake. */
const connected = async (overrides: Partial<Record<string, unknown>> = {}) => {
    const r = realm()
    const parent = parentPort()
    postToWindow(r, hello(overrides), [parent.port2])
    expect(await parent.next()).toEqual({v: 1, type: "hello-ack"})
    await r.agenta.ready
    return {...r, parent}
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

/** Everything the stub sent after the handshake's own `hello-ack`. */
const sinceHello = (received: IframeToParent[]) =>
    received.filter((msg) => !("type" in msg && msg.type === "hello-ack"))

afterEach(() => {
    for (const channel of channels.splice(0)) {
        channel.port1.close()
        channel.port2.close()
    }
    for (const frame of frames.splice(0)) frame.remove()
})

describe("BRIDGE_STUB shape", () => {
    it("is a self-invoking function expression, ES2017-safe, with no module references", () => {
        expect(BRIDGE_STUB.startsWith("(function")).toBe(true)
        expect(BRIDGE_STUB.endsWith(")()")).toBe(true)
        expect(buildBridgeStub()).toBe(BRIDGE_STUB)
        expect(BRIDGE_STUB).not.toMatch(/\bimport\b|\brequire\(|\bexport\b/)
        expect(BRIDGE_STUB).not.toContain("</script")
        // No syntax a bundler would rewrite into a shared helper.
        expect(BRIDGE_STUB).not.toMatch(/\?\?|\?\.|\.\.\./)
    })

    it("installs window.agenta before any hello arrives", () => {
        const {agenta} = realm()
        expect(agenta.version).toBe(1)
        expect(agenta.canWrite).toBe(false)
        expect(agenta.dir).toBe("")
        expect(agenta.visible).toBe(true)
        expect(Object.keys(agenta.fs).sort()).toEqual([
            "exists",
            "list",
            "read",
            "readJSON",
            "remove",
            "stat",
            "write",
            "writeJSON",
        ])
        // Cross-realm: the iframe's Promise is not this realm's `Promise`.
        expect(typeof agenta.ready.then).toBe("function")
    })
})

describe("handshake", () => {
    it("adopts the port, applies the hello, writes the token style and acks", async () => {
        const {agenta, doc} = await connected()
        expect(agenta.canWrite).toBe(true)
        expect(agenta.dir).toBe("apps/board")
        expect(agenta.visible).toBe(true)
        const style = doc.getElementById("agenta-tokens") as HTMLStyleElement
        expect(style.tagName).toBe("STYLE")
        expect(style.parentElement).toBe(doc.head)
        expect(style.textContent).toBe(":root{--ag-bg:#fff;--ag-fg:#111;}")
    })

    it("ignores hello messages without a port and non-hello messages", async () => {
        const r = realm()
        const parent = parentPort()
        let settled = false
        r.agenta.ready.then(() => {
            settled = true
        })
        postToWindow(r, hello())
        postToWindow(r, {v: 1, type: "visibility", visible: false}, [parent.port2])
        await tick()
        expect(settled).toBe(false)
        expect(r.agenta.dir).toBe("")
        expect(parent.received).toEqual([])
    })

    it("a hello with another version rejects ready and shows a one-line notice", async () => {
        const r = realm()
        const parent = parentPort()
        const outcome = r.agenta.ready.then(
            () => "resolved",
            (error: Error & {code?: string}) => `rejected:${error.code}`,
        )
        postToWindow(r, hello({v: 2}), [parent.port2])
        expect(await outcome).toBe("rejected:unavailable")
        const notice = r.doc.querySelector("[data-agenta-notice]")
        expect(notice?.textContent).toContain("v2")
        expect(notice?.textContent).toContain("expected v1")
        expect(parent.received).toEqual([])
    })

    it("queues fs calls made before hello and flushes them in order after it", async () => {
        const r = realm()
        const parent = parentPort()
        const first = r.agenta.fs.read("a.txt")
        const second = r.agenta.fs.exists("b.txt")
        await tick()
        expect(parent.received).toEqual([])
        postToWindow(r, hello(), [parent.port2])
        const flushed = [await parent.next(), await parent.next(), await parent.next()]
        expect(flushed[0]).toMatchObject({id: 1, method: "read", path: "a.txt"})
        expect(flushed[1]).toMatchObject({id: 2, method: "exists", path: "b.txt"})
        expect(flushed[2]).toEqual({v: 1, type: "hello-ack"})
        parent.send({v: 1, id: 1, ok: true, result: "A"})
        parent.send({v: 1, id: 2, ok: true, result: false})
        expect(await first).toBe("A")
        expect(await second).toBe(false)
    })

    it("a second hello replaces the port", async () => {
        const r = await connected()
        const replacement = parentPort()
        postToWindow(r, hello({dir: "apps/other", canWrite: false}), [replacement.port2])
        expect(await replacement.next()).toEqual({v: 1, type: "hello-ack"})
        expect(r.agenta.dir).toBe("apps/other")
        expect(r.agenta.canWrite).toBe(false)
        void r.agenta.fs.read("x")
        expect(await replacement.next()).toMatchObject({method: "read", path: "x"})
    })
})

describe("fs requests", () => {
    it("serialises every method to an FsRequest with incrementing ids", async () => {
        const {agenta, parent} = await connected()
        void agenta.fs.read("a")
        void agenta.fs.readJSON("b.json")
        void agenta.fs.write("c", "text")
        void agenta.fs.writeJSON("d.json", {x: 1}, {force: true})
        void agenta.fs.list()
        void agenta.fs.list("sub/")
        void agenta.fs.exists("e")
        void agenta.fs.stat("f")
        void agenta.fs.remove("g", {force: true})
        const seen: FsRequest[] = []
        for (let i = 0; i < 9; i++) seen.push((await parent.next()) as FsRequest)
        expect(seen).toEqual([
            {v: 1, id: 1, method: "read", path: "a"},
            {v: 1, id: 2, method: "readJSON", path: "b.json"},
            {v: 1, id: 3, method: "write", path: "c", body: "text"},
            {v: 1, id: 4, method: "writeJSON", path: "d.json", body: '{"x":1}', force: true},
            {v: 1, id: 5, method: "list", path: ""},
            {v: 1, id: 6, method: "list", path: "sub/"},
            {v: 1, id: 7, method: "exists", path: "e"},
            {v: 1, id: 8, method: "stat", path: "f"},
            {v: 1, id: 9, method: "remove", path: "g", force: true},
        ])
    })

    it("matches responses to requests by id, even out of order", async () => {
        const {agenta, parent} = await connected()
        const a = agenta.fs.read("a")
        const b = agenta.fs.read("b")
        const c = agenta.fs.stat("c")
        const ids = [
            ((await parent.next()) as FsRequest).id,
            ((await parent.next()) as FsRequest).id,
            ((await parent.next()) as FsRequest).id,
        ]
        parent.send({v: 1, id: ids[2], ok: true, result: {path: "c", size: 1, mtime: null}})
        parent.send({v: 1, id: ids[1], ok: true, result: "B"})
        parent.send({v: 1, id: ids[0], ok: true, result: "A"})
        expect(await Promise.all([a, b, c])).toEqual(["A", "B", {path: "c", size: 1, mtime: null}])
    })

    it("rejects with an Error carrying .code and .etag on failure", async () => {
        const {agenta, parent, win} = await connected()
        const promise = agenta.fs.write("a", "x")
        const {id} = (await parent.next()) as FsRequest
        parent.send({
            v: 1,
            id,
            ok: false,
            error: {code: "conflict", message: "changed", etag: "server-etag"},
        })
        const error = (await promise.catch((e: unknown) => e)) as Error & {
            code: string
            etag: string | null
        }
        // Cross-realm: the stub's Error is the iframe realm's constructor.
        expect(error instanceof win.Error).toBe(true)
        expect(error.message).toBe("changed")
        expect(error.code).toBe("conflict")
        expect(error.etag).toBe("server-etag")

        const second = agenta.fs.read("nope")
        const req2 = (await parent.next()) as FsRequest
        parent.send({v: 1, id: req2.id, ok: false, error: {code: "not_found", message: "no"}})
        const notFound = (await second.catch((e: unknown) => e)) as Error & {code: string}
        expect(notFound.code).toBe("not_found")
        expect("etag" in notFound).toBe(false)
    })

    it("readJSON parses a text result and rejects invalid JSON with bad_request", async () => {
        const {agenta, parent} = await connected()
        const ok = agenta.fs.readJSON("a.json")
        parent.send({
            v: 1,
            id: ((await parent.next()) as FsRequest).id,
            ok: true,
            result: '{"a":1}',
        })
        expect(await ok).toEqual({a: 1})

        // A host that already parsed (the mock does) is accepted as-is.
        const parsed = agenta.fs.readJSON("b.json")
        parent.send({v: 1, id: ((await parent.next()) as FsRequest).id, ok: true, result: [1, 2]})
        expect(await parsed).toEqual([1, 2])

        const bad = agenta.fs.readJSON("c.json")
        parent.send({v: 1, id: ((await parent.next()) as FsRequest).id, ok: true, result: "{oops"})
        const error = (await bad.catch((e: unknown) => e)) as Error & {code: string}
        expect(error.code).toBe("bad_request")
    })

    it("write/writeJSON refuse locally what cannot be sent", async () => {
        const {agenta, parent} = await connected()
        const circular: Record<string, unknown> = {}
        circular.self = circular
        const errors = await Promise.all([
            agenta.fs.write("a", 42 as unknown as string).catch((e: {code: string}) => e.code),
            agenta.fs.writeJSON("a", circular).catch((e: {code: string}) => e.code),
            agenta.fs.writeJSON("a", undefined).catch((e: {code: string}) => e.code),
        ])
        expect(errors).toEqual(["bad_request", "bad_request", "bad_request"])
        await tick()
        expect(sinceHello(parent.received)).toEqual([])
    })

    it("ignores port messages that are not v1 or that answer an unknown id", async () => {
        const {agenta, parent} = await connected()
        const promise = agenta.fs.read("a")
        const {id} = (await parent.next()) as FsRequest
        parent.send({v: 2, id, ok: true, result: "wrong version"} as unknown as ParentToIframe)
        parent.send({v: 1, id: id + 100, ok: true, result: "unknown id"})
        await tick()
        parent.send({v: 1, id, ok: true, result: "right"})
        expect(await promise).toBe("right")
    })
})

describe("host → app events", () => {
    it("visibility updates agenta.visible and dispatches visibilitychange with a plain object", async () => {
        const {agenta, parent, win} = await connected()
        const seen: unknown[] = []
        const off = agenta.addEventListener("visibilitychange", (detail) => seen.push(detail))
        parent.send({v: 1, type: "visibility", visible: false})
        await tick()
        expect(agenta.visible).toBe(false)
        expect(seen).toEqual([{visible: false}])
        // A plain object literal of the iframe realm — not a DOM CustomEvent.
        expect(Object.getPrototypeOf(seen[0])).toBe(win.Object.prototype)
        off()
        parent.send({v: 1, type: "visibility", visible: true})
        await tick()
        expect(agenta.visible).toBe(true)
        expect(seen).toHaveLength(1)
    })

    it("changed dispatches the paths; removeEventListener stops delivery", async () => {
        const {agenta, parent} = await connected()
        const seen: unknown[] = []
        const cb = (detail: unknown) => seen.push(detail)
        agenta.addEventListener("changed", cb)
        parent.send({v: 1, type: "changed", paths: ["data/a.json", "b.txt"]})
        await tick()
        expect(seen).toEqual([{paths: ["data/a.json", "b.txt"]}])
        agenta.removeEventListener("changed", cb)
        parent.send({v: 1, type: "changed", paths: ["c"]})
        await tick()
        expect(seen).toHaveLength(1)
    })

    it("theme rewrites the token block in place and dispatches theme", async () => {
        const {agenta, doc, parent} = await connected()
        const seen: unknown[] = []
        agenta.addEventListener("theme", (detail) => seen.push(detail))
        parent.send({
            v: 1,
            type: "theme",
            tokens: {"--ag-bg": "#000", "--ag-font": "Inter, sans-serif"},
        })
        await tick()
        const styles = doc.querySelectorAll("#agenta-tokens")
        expect(styles).toHaveLength(1)
        expect(styles[0].textContent).toBe(":root{--ag-bg:#000;--ag-font:Inter, sans-serif;}")
        expect(seen).toEqual([{tokens: {"--ag-bg": "#000", "--ag-font": "Inter, sans-serif"}}])
    })

    it("drops token names that are not custom properties and strips CSS breakers from values", async () => {
        const {doc} = await connected({
            tokens: {"--ag-bg": "#fff", color: "red", "--ag-x": "a;} body{display:none}"},
        })
        expect(doc.getElementById("agenta-tokens")?.textContent).toBe(
            ":root{--ag-bg:#fff;--ag-x:a bodydisplay:none;}",
        )
    })

    it("a throwing listener does not stop the others", async () => {
        const {agenta, parent} = await connected()
        const seen: unknown[] = []
        agenta.addEventListener("changed", () => {
            throw new Error("listener bug")
        })
        agenta.addEventListener("changed", (detail) => seen.push(detail))
        parent.send({v: 1, type: "changed", paths: ["a"]})
        await tick()
        expect(seen).toEqual([{paths: ["a"]}])
    })
})

describe("error forwarding", () => {
    it("forwards window error events as ScriptErrorMsg with source/line/col", async () => {
        const {win, parent} = await connected()
        const event = new win.ErrorEvent("error", {
            message: "boom",
            filename: "index.html",
            lineno: 12,
            colno: 3,
            error: new Error("boom"),
        })
        win.dispatchEvent(event)
        expect(await parent.next()).toEqual({
            v: 1,
            type: "error",
            message: "boom",
            source: "index.html",
            line: 12,
            col: 3,
        })
    })

    it("forwards unhandled rejections with the reason's message", async () => {
        const {win, parent} = await connected()
        const event = new win.Event("unhandledrejection") as Event & {reason: unknown}
        event.reason = new Error("nope")
        win.dispatchEvent(event)
        expect(await parent.next()).toMatchObject({
            v: 1,
            type: "error",
            message: "Unhandled rejection: nope",
        })
    })

    it("buffers errors raised before hello and flushes them after the ack path", async () => {
        const r = realm()
        const parent = parentPort()
        r.win.dispatchEvent(new r.win.ErrorEvent("error", {message: "early", lineno: 1}))
        await tick()
        expect(parent.received).toEqual([])
        postToWindow(r, hello(), [parent.port2])
        const first = await parent.next()
        const second = await parent.next()
        expect(first).toMatchObject({type: "error", message: "early", line: 1})
        expect(second).toEqual({v: 1, type: "hello-ack"})
    })
})

describe("link interception", () => {
    const click = (r: Realm, el: Element) => {
        const event = new r.win.MouseEvent("click", {bubbles: true, cancelable: true})
        el.dispatchEvent(event)
        return event.defaultPrevented
    }

    it("turns an internal relative link into a nav message and prevents the default", async () => {
        const r = await connected()
        const a = r.doc.createElement("a")
        a.setAttribute("href", "pages/about.html")
        const span = r.doc.createElement("span")
        span.textContent = "About"
        a.appendChild(span)
        r.doc.body.appendChild(a)
        expect(click(r, span)).toBe(true)
        expect(await r.parent.next()).toEqual({v: 1, type: "nav", href: "pages/about.html"})
    })

    it("keeps a fragment link in the document: a hash change, no nav, no navigation", async () => {
        // A srcdoc document resolves `#x` against the host app's URL, so the browser's default
        // would navigate the frame to the app. The stub turns it into a same-document hash change.
        const r = await connected()
        const a = r.doc.createElement("a")
        a.setAttribute("href", "#section-2")
        r.doc.body.appendChild(a)
        expect(click(r, a)).toBe(true)
        expect(r.win.location.hash).toBe("#section-2")
        await tick()
        expect(sinceHello(r.parent.received)).toEqual([])
    })

    it("lets external and protocol-relative links fall through", async () => {
        const r = await connected()
        for (const href of ["https://example.com", "mailto:x@y.z", "//cdn.example.com/x"]) {
            const a = r.doc.createElement("a")
            a.setAttribute("href", href)
            r.doc.body.appendChild(a)
            expect(click(r, a), href).toBe(false)
        }
        const noHref = r.doc.createElement("a")
        r.doc.body.appendChild(noHref)
        expect(click(r, noHref)).toBe(false)
        await tick()
        expect(sinceHello(r.parent.received)).toEqual([])
    })
})
