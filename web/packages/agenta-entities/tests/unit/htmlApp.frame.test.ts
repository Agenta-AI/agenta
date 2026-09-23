// @vitest-environment jsdom
/**
 * The wrapper frame the app runs in (`buildRunFrame`).
 *
 * Two properties, both security ones. The wrapper's CSP must refuse every navigation of the app's
 * frame (a sandboxed frame can always navigate itself, and that is how it would carry data out).
 * And the bridge port must reach the app's FIRST document only: the hello goes to `"*"`, so a
 * document that replaced the app would otherwise receive a live port onto the drive.
 *
 * The wrapper script runs in a fresh jsdom realm per test. jsdom does not render srcdoc, but it
 * does fire the nested frame's first `load`; a later load (what a navigation looks like from the
 * wrapper) is dispatched by hand.
 */
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    buildRunFrame,
    buildRunFrameScript,
    isFrameNavigated,
    RUN_FRAME_CSP,
} from "../../src/drive/htmlApp/frame"
import {RUN_CSP, SANDBOX_FLAGS} from "../../src/drive/htmlApp/protocol"

type RealmWindow = Window & {eval(code: string): unknown}

const frames: HTMLIFrameElement[] = []
const channels: MessageChannel[] = []

afterEach(() => {
    for (const channel of channels.splice(0)) {
        channel.port1.close()
        channel.port2.close()
    }
    for (const frame of frames.splice(0)) frame.remove()
    vi.restoreAllMocks()
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

/** A wrapper realm running the script; by default the app frame's first load has fired. */
const wrapper = async (appHtml = "<p>app</p>", {loaded = true} = {}) => {
    const outer = document.createElement("iframe")
    document.body.appendChild(outer)
    frames.push(outer)
    const win = outer.contentWindow as RealmWindow
    // What the wrapper tells its parent (the host) goes through `parent.postMessage`.
    const toHost = vi.fn()
    ;(win.parent as unknown as {postMessage: unknown}).postMessage = toHost
    win.eval(buildRunFrameScript(appHtml))
    const app = win.document.querySelector("iframe") as HTMLIFrameElement
    // Forwarded messages land on the app frame's window.
    const toApp = vi.fn()
    ;(app.contentWindow as unknown as {postMessage: unknown}).postMessage = toApp
    if (loaded) await tick()
    return {win, app, toApp, toHost}
}

/** A message into the wrapper realm, as `iframe.contentWindow.postMessage` delivers it. */
const deliver = (win: Window, data: unknown, source: unknown, ports: MessagePort[]) => {
    const event = new win.Event("message") as Event & Record<string, unknown>
    Object.defineProperty(event, "data", {value: data})
    Object.defineProperty(event, "source", {value: source})
    Object.defineProperty(event, "ports", {value: ports})
    win.dispatchEvent(event)
}

const hello = {v: 1, type: "hello", dir: "apps/x", canWrite: true, visible: true, tokens: {}}

const port = () => {
    const channel = new MessageChannel()
    channels.push(channel)
    return channel.port2
}

/** What a navigation of the app's frame looks like from the wrapper: another load. */
const navigate = (app: HTMLIFrameElement) => app.dispatchEvent(new Event("load"))

describe("wrapper document", () => {
    it("carries the app policy plus frame-src 'none' as its own CSP", () => {
        expect(RUN_FRAME_CSP).toContain(RUN_CSP)
        expect(RUN_FRAME_CSP).toContain("frame-src 'none'")
        const doc = new DOMParser().parseFromString(buildRunFrame("<p>x</p>"), "text/html")
        const meta = doc.querySelector('meta[http-equiv="Content-Security-Policy"]')
        expect(meta?.getAttribute("content")).toBe(RUN_FRAME_CSP)
    })

    it("cannot be broken out of by the app's own markup", () => {
        const hostile = `</script><script>window.pwned=1</script><!-- ${String.fromCharCode(0x2028)}`
        const doc = new DOMParser().parseFromString(buildRunFrame(hostile), "text/html")
        expect(doc.querySelectorAll("script")).toHaveLength(1)
    })

    it("sandboxes the app frame with the run flags and hands it the app as srcdoc", async () => {
        const {app} = await wrapper("<p>the app</p>")
        expect(app.getAttribute("sandbox")).toBe(SANDBOX_FLAGS)
        expect(app.getAttribute("srcdoc")).toBe("<p>the app</p>")
    })
})

describe("the bridge port reaches the app's first document only", () => {
    it("forwards the host's hello with its port to the app", async () => {
        const {win, toApp} = await wrapper()
        const p = port()
        deliver(win, hello, win.parent, [p])
        expect(toApp).toHaveBeenCalledTimes(1)
        expect(toApp).toHaveBeenCalledWith(hello, "*", [p])
    })

    it("never forwards a hello once the app frame navigated, and tells the host", async () => {
        const {win, app, toApp, toHost} = await wrapper()
        navigate(app)
        deliver(win, hello, win.parent, [port()])
        expect(toApp).not.toHaveBeenCalled()
        expect(toHost).toHaveBeenCalledWith({v: 1, type: "frame-navigated"}, "*")
        expect(win.document.querySelector("iframe")).toBeNull()
    })

    it("reports a navigation after the handshake and drops the app frame", async () => {
        const {win, app, toApp, toHost} = await wrapper()
        deliver(win, hello, win.parent, [port()])
        expect(toApp).toHaveBeenCalledTimes(1)
        navigate(app)
        expect(toHost).toHaveBeenCalledTimes(1)
        expect(isFrameNavigated(toHost.mock.calls[0][0])).toBe(true)
        expect(win.document.querySelector("iframe")).toBeNull()
    })

    it("forwards one hello, ever", async () => {
        const {win, toApp} = await wrapper()
        deliver(win, hello, win.parent, [port()])
        deliver(win, hello, win.parent, [port()])
        expect(toApp).toHaveBeenCalledTimes(1)
    })

    it("ignores a hello from anyone but the host", async () => {
        const {win, app, toApp} = await wrapper()
        deliver(win, hello, app.contentWindow, [port()])
        deliver(win, hello, null, [port()])
        expect(toApp).not.toHaveBeenCalled()
        // The real one still goes through afterwards.
        deliver(win, hello, win.parent, [port()])
        expect(toApp).toHaveBeenCalledTimes(1)
    })

    it("ignores anything that is not a hello with exactly one port", async () => {
        const {win, toApp} = await wrapper()
        deliver(win, {v: 1, type: "theme", tokens: {}}, win.parent, [port()])
        deliver(win, hello, win.parent, [])
        deliver(win, hello, win.parent, [port(), port()])
        expect(toApp).not.toHaveBeenCalled()
    })
})

describe("ports the wrapper does not forward are closed", () => {
    // A port left open stays entangled with the host's end; closing it is what makes a refused
    // hello inert rather than merely unforwarded.
    const closeSpy = () => {
        const p = port()
        return {p, close: vi.spyOn(p, "close")}
    }

    it("closes a second hello's port", async () => {
        const {win} = await wrapper()
        deliver(win, hello, win.parent, [port()])
        const second = closeSpy()
        deliver(win, hello, win.parent, [second.p])
        expect(second.close).toHaveBeenCalled()
    })

    it("closes a hello's port that arrives after the app navigated", async () => {
        const {win, app} = await wrapper()
        navigate(app)
        const late = closeSpy()
        deliver(win, hello, win.parent, [late.p])
        expect(late.close).toHaveBeenCalled()
    })

    it("closes a second hello's port while the first is still waiting for the load", async () => {
        const {win} = await wrapper("<p>app</p>", {loaded: false})
        deliver(win, hello, win.parent, [port()])
        const second = closeSpy()
        deliver(win, hello, win.parent, [second.p])
        expect(second.close).toHaveBeenCalled()
    })
})

describe("a hello that arrives before the app loaded", () => {
    it("waits for the first load, then forwards exactly once", async () => {
        const {win, toApp} = await wrapper("<p>app</p>", {loaded: false})
        deliver(win, hello, win.parent, [port()])
        expect(toApp, "nothing is forwarded before the app's first load").not.toHaveBeenCalled()
        await tick()
        expect(toApp).toHaveBeenCalledTimes(1)
    })
})

describe("isFrameNavigated", () => {
    it("accepts only the versioned message", () => {
        expect(isFrameNavigated({v: 1, type: "frame-navigated"})).toBe(true)
        expect(isFrameNavigated({v: 2, type: "frame-navigated"})).toBe(false)
        expect(isFrameNavigated({type: "frame-navigated"})).toBe(false)
        expect(isFrameNavigated(null)).toBe(false)
    })
})
