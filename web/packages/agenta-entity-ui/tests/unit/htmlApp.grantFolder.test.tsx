/**
 * A grant belongs to one folder.
 *
 * The drive renders the HTML body without a key, and a file whose content is already cached
 * renders with no loading gap to remount it. So picking an app in folder B while an app runs
 * reused the body that held folder A's grant, and the host was built for B under A's level.
 * `HtmlAppBody` builds one host per folder from that folder's own answer; these tests pin that.
 */

import {act} from "react"

import type {HtmlAppHost, HtmlAppHostOptions} from "@agenta/entities/drive"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {createGrantStore, HtmlAppBody, HtmlAppEnvContext} from "../../src/drive/htmlApp/HtmlAppBody"

const MOUNT = {id: "m1"} as never
const A = "apps/a/index.html"
const B = "apps/b/index.html"

const stubHost = (): HtmlAppHost => ({
    attach: vi.fn(),
    detach: vi.fn(),
    setVisible: vi.fn(),
    setTheme: vi.fn(),
    notifyChanged: vi.fn(),
    onError: () => () => undefined,
    onNav: () => () => undefined,
})

const io = {
    fetchText: (path: string) =>
        Promise.resolve(
            path.endsWith("app.json")
                ? JSON.stringify({agenta_app: 1, name: "App", access: "read-write"})
                : null,
        ),
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
        await Promise.resolve()
        await Promise.resolve()
    })

describe("switching folders while an app runs", () => {
    const setup = () => {
        const grants = createGrantStore()
        grants.set("m1", "apps/a", {level: "read-write", writeRefused: false})
        const createHost = vi.fn((_opts: HtmlAppHostOptions) => stubHost())
        const render = (path: string) =>
            act(async () => {
                root.render(
                    <HtmlAppEnvContext.Provider
                        value={{
                            io,
                            createHost,
                            grants,
                            canEditMounts: true,
                            kitCss: "",
                            bridgeStub: "",
                            resolveTokens: () => ({}),
                        }}
                    >
                        <HtmlAppBody mount={MOUNT} path={path} content="<html></html>" />
                    </HtmlAppEnvContext.Provider>,
                )
            })
        const hostsFor = (dir: string) =>
            createHost.mock.calls.map(([opts]) => opts).filter((opts) => opts.dir === dir)
        return {render, hostsFor}
    }

    it("does not carry folder A's grant to folder B", async () => {
        const {render, hostsFor} = setup()
        await render(A)
        await settle()
        expect(hostsFor("apps/a").map((o) => o.grant)).toContain("read-write")

        await render(B)
        await settle()

        const b = hostsFor("apps/b")
        expect(b.length, "folder B runs too").toBeGreaterThan(0)
        expect(b.every((o) => o.grant === "none" && o.requestAccess), "and asks for itself").toBe(
            true,
        )
    })

    it("keeps the grant for another file in the same folder", async () => {
        const {render, hostsFor} = setup()
        await render(A)
        await settle()
        await render("apps/a/other.html")
        await settle()
        const hosts = hostsFor("apps/a")
        expect(hosts.length).toBeGreaterThan(0)
        expect(hosts.every((o) => o.grant === "read-write")).toBe(true)
    })
})

describe("a new host while the app stays open", () => {
    it("gets a fresh frame, so the new host is attached on its first load", async () => {
        const grants = createGrantStore()
        grants.set("m1", "apps/a", {level: "read-write", writeRefused: false})
        const hosts: HtmlAppHost[] = []
        const factory = () => {
            const host = stubHost()
            hosts.push(host)
            return host
        }
        const render = (createHost: () => HtmlAppHost) =>
            act(async () => {
                root.render(
                    <HtmlAppEnvContext.Provider
                        value={{
                            io,
                            createHost,
                            grants,
                            canEditMounts: true,
                            kitCss: "",
                            bridgeStub: "",
                            resolveTokens: () => ({}),
                        }}
                    >
                        <HtmlAppBody mount={MOUNT} path={A} content="<html></html>" />
                    </HtmlAppEnvContext.Provider>,
                )
            })
        const waitForFrame = async () => {
            await settle()
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 20))
            })
            return container.querySelector("iframe")
        }

        await render(() => factory())
        const first = await waitForFrame()
        expect(first).toBeTruthy()

        // A different factory recreates the host, as a grant or project change does.
        await render(() => factory())
        const second = await waitForFrame()
        const latest = hosts[hosts.length - 1]
        expect(hosts.length).toBeGreaterThan(1)
        expect(second).toBeTruthy()
        expect(second).not.toBe(first)
        if ((latest.attach as ReturnType<typeof vi.fn>).mock.calls.length === 0) {
            await act(async () => {
                second!.dispatchEvent(new Event("load"))
            })
        }
        expect(latest.attach).toHaveBeenCalledWith(second)
    })
})
