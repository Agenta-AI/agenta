/**
 * A grant belongs to one folder.
 *
 * The drive renders the HTML body without a key, and a file whose content is already cached
 * renders with no loading gap to remount it. So picking an app in folder B while Run is selected
 * reused the body that held folder A's grant, and the host was built for B under A's level.
 * `HtmlAppBody` resets its folder state when the mount or folder changes; these tests pin that.
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

describe("switching folders while Run is selected", () => {
    const setup = () => {
        const grants = createGrantStore()
        grants.set("m1", "apps/a", "read-write", "read-write")
        const createHost = vi.fn((_opts: HtmlAppHostOptions) => stubHost())
        const render = (path: string, controlledView?: "preview" | "run") =>
            act(async () => {
                root.render(
                    <HtmlAppEnvContext.Provider
                        value={{
                            enabled: true,
                            io,
                            createHost,
                            grants,
                            canEditMounts: true,
                            kitCss: "",
                            bridgeStub: "",
                            resolveTokens: () => ({}),
                        }}
                    >
                        <HtmlAppBody
                            mount={MOUNT}
                            path={path}
                            content="<html></html>"
                            controlledView={controlledView}
                        />
                    </HtmlAppEnvContext.Provider>,
                )
            })
        const hostsFor = (dir: string) =>
            createHost.mock.calls.map(([opts]) => opts).filter((opts) => opts.dir === dir)
        return {render, hostsFor}
    }

    it("does not carry folder A's grant to folder B (host-owned tabs)", async () => {
        const {render, hostsFor} = setup()
        await render(A, "run")
        await settle()
        expect(hostsFor("apps/a").map((o) => o.grant)).toContain("read-write")

        await render(B, "run")
        await settle()

        expect(hostsFor("apps/b"), "folder B has no grant yet").toEqual([])
    })

    it("does not carry folder A's grant to folder B (own tabs)", async () => {
        const {render, hostsFor} = setup()
        await render(A)
        await settle()
        const run = [...container.querySelectorAll("*")].find(
            (el) => el.children.length === 0 && el.textContent?.trim() === "Run",
        )
        await act(async () => {
            run?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })
        await settle()
        expect(hostsFor("apps/a")).not.toEqual([])

        await render(B)
        await settle()
        expect(hostsFor("apps/b")).toEqual([])
    })

    it("keeps the grant for another file in the same folder", async () => {
        const {render, hostsFor} = setup()
        await render(A, "run")
        await settle()
        await render("apps/a/other.html", "run")
        await settle()
        const hosts = hostsFor("apps/a")
        expect(hosts.length).toBeGreaterThan(0)
        expect(hosts.every((o) => o.grant === "read-write")).toBe(true)
    })
})

describe("a new host while Run stays open", () => {
    it("gets a fresh frame, so the new host is attached on its first load", async () => {
        const grants = createGrantStore()
        grants.set("m1", "apps/a", "read-write", "read-write")
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
                            enabled: true,
                            io,
                            createHost,
                            grants,
                            canEditMounts: true,
                            kitCss: "",
                            bridgeStub: "",
                            resolveTokens: () => ({}),
                        }}
                    >
                        <HtmlAppBody
                            mount={MOUNT}
                            path={A}
                            content="<html></html>"
                            controlledView="run"
                        />
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
