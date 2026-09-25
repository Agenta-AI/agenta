/**
 * The Run view hands the bridge port to the app's first document and to nothing after it.
 *
 * The hello goes to `"*"` (the app is an opaque origin), so whatever document sits in the frame
 * when it is sent gets a live port onto the drive. An app that navigated its own frame used to
 * fire `load` again and be re-attached: the page it navigated to received the port. Now a second
 * load of the same frame, or the wrapper reporting that the app's frame loaded another document,
 * stops the app: the host is detached, the frame is removed, and it stays stopped until reload.
 */

import {act} from "react"

import {RUN_FRAME_CSP, type HtmlAppHost} from "@agenta/entities/drive"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {RunView} from "../../src/drive/htmlApp/RunView"

const fakeHost = () => {
    const nav: {fire?: (href: string) => void} = {}
    return {
        attach: vi.fn(),
        detach: vi.fn(),
        setVisible: vi.fn(),
        setTheme: vi.fn(),
        notifyChanged: vi.fn(),
        onError: () => () => undefined,
        onNav: (cb: (href: string) => void) => {
            nav.fire = cb
            return () => undefined
        },
        nav,
    } satisfies HtmlAppHost & {nav: typeof nav}
}

/** Serves sibling pages of the app. */
const siblingIo = {
    fetchText: (path: string) =>
        Promise.resolve(path.endsWith("missing.html") ? null : `<html><body>${path}</body></html>`),
    fetchDataUri: () => Promise.resolve(null),
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const settle = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
    })

const frame = () => container.querySelector("iframe")

const mount = async (
    host: HtmlAppHost,
    changedPaths: string[] = [],
    io: typeof siblingIo | null = null,
) => {
    await act(async () => {
        root.render(
            <RunView
                host={host}
                dir="apps/x"
                entryPath="apps/x/index.html"
                entryContent="<html><body>app</body></html>"
                grant="read-write"
                io={io}
                kitCss={null}
                bridgeStub=""
                resolveTokens={() => ({})}
                changedPaths={changedPaths}
            />,
        )
    })
    await settle()
}

/** A load event on the frame, as any document replacing the current one fires it. */
const load = (el: HTMLIFrameElement) =>
    act(async () => {
        el.dispatchEvent(new Event("load"))
    })

describe("Run frame", () => {
    it("renders the app inside the navigation-guarding wrapper", async () => {
        await mount(fakeHost())
        const srcdoc = frame()?.getAttribute("srcdoc") ?? ""
        expect(srcdoc).toContain(RUN_FRAME_CSP)
        expect(srcdoc).toContain("frame-src 'none'")
    })

    it("attaches on the first load only; a second load stops the app", async () => {
        const host = fakeHost()
        await mount(host)
        const first = frame()
        expect(first).toBeTruthy()
        // jsdom fires the first load itself; make sure there was exactly one attach for it.
        if (host.attach.mock.calls.length === 0) await load(first!)
        expect(host.attach).toHaveBeenCalledTimes(1)
        expect(host.attach).toHaveBeenCalledWith(first)

        await load(first!)

        expect(host.attach, "a navigated frame must never get a port").toHaveBeenCalledTimes(1)
        expect(host.detach).toHaveBeenCalled()
        expect(frame(), "the navigated frame is removed").toBeNull()
        expect(container.textContent).toContain("Stopped")
    })

    it("stops when the wrapper reports the app's frame navigated", async () => {
        const host = fakeHost()
        await mount(host)
        const el = frame()!
        await act(async () => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {v: 1, type: "frame-navigated"},
                    source: el.contentWindow,
                }),
            )
        })
        expect(host.detach).toHaveBeenCalled()
        expect(frame()).toBeNull()
    })

    it("ignores a frame-navigated message from anyone but its own wrapper", async () => {
        const host = fakeHost()
        await mount(host)
        await act(async () => {
            window.dispatchEvent(
                new MessageEvent("message", {
                    data: {v: 1, type: "frame-navigated"},
                    source: window,
                }),
            )
        })
        expect(frame()).toBeTruthy()
    })

    it("ignores other messages from its own wrapper", async () => {
        const host = fakeHost()
        await mount(host)
        const el = frame()!
        await act(async () => {
            for (const data of [{v: 1, type: "nav", href: "x"}, {type: "frame-navigated"}, "x"]) {
                window.dispatchEvent(new MessageEvent("message", {data, source: el.contentWindow}))
            }
        })
        expect(frame()).toBe(el)
        expect(container.textContent).not.toContain("Stopped")
    })

    it.each([
        ["a sibling page", "sub.html"],
        ["a missing sibling page", "missing.html"],
    ])("gives %s a fresh frame with its own first attach", async (_label, href) => {
        const host = fakeHost()
        await mount(host, [], siblingIo)
        const first = frame()!
        if (host.attach.mock.calls.length === 0) await load(first)
        expect(host.attach).toHaveBeenCalledTimes(1)

        await act(async () => {
            host.nav.fire?.(href)
        })
        await settle()

        const second = frame()
        expect(second, "the new page renders in a new iframe").toBeTruthy()
        expect(second).not.toBe(first)
        if (host.attach.mock.calls.length === 1) await load(second!)
        expect(host.attach).toHaveBeenCalledTimes(2)
        expect(host.attach).toHaveBeenLastCalledWith(second)
        expect(container.textContent).not.toContain("Stopped")
    })

    it("reload starts a fresh frame, which gets its own first attach", async () => {
        const host = fakeHost()
        await mount(host, ["apps/x/data.json"])
        const first = frame()!
        if (host.attach.mock.calls.length === 0) await load(first)
        await load(first)
        expect(frame()).toBeNull()

        const reload = [...container.querySelectorAll("button")].find((b) =>
            b.textContent?.includes("Reload"),
        )
        await act(async () => {
            reload?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        await settle()
        const second = frame()
        expect(second).toBeTruthy()
        expect(second).not.toBe(first)
        if (host.attach.mock.calls.length === 1) await load(second!)
        expect(host.attach).toHaveBeenCalledTimes(2)
        expect(host.attach).toHaveBeenLastCalledWith(second)
    })
})
