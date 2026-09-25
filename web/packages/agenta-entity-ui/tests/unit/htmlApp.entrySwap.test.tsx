/**
 * Swapping the entry file while Run stays selected.
 *
 * The Run view keeps its own page: an app that navigated to a sub-page has `currentPath` pointing
 * there, not at the entry. Swapping the entry file underneath a live view therefore has to reset
 * that, or the reader picks a different app in the drive and keeps reading the previous one's
 * sub-page under the new app's name. `HtmlAppBody` keys the view by its entry so the reset is the
 * remount, rather than a list of fields someone has to remember to clear.
 */

import {act} from "react"

import type {GrantLevel, HtmlAppHost} from "@agenta/entities/drive"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {createGrantStore, HtmlAppBody, HtmlAppEnvContext} from "../../src/drive/htmlApp/HtmlAppBody"

const MOUNT = {id: "m1"} as never
const DIR = "apps/board"
const ENTRY = `${DIR}/index.html`
const OTHER = `${DIR}/other.html`
const SUB = `${DIR}/sub.html`

/** Captures the `nav` callback so a test can make the app navigate. */
const navHost = (sink: {fire?: (href: string) => void}): HtmlAppHost => ({
    attach: vi.fn(),
    detach: vi.fn(),
    setVisible: vi.fn(),
    setTheme: vi.fn(),
    notifyChanged: vi.fn(),
    onError: () => () => undefined,
    onNav: (cb: (href: string) => void) => {
        sink.fire = cb
        return () => undefined
    },
})

const io = (access: GrantLevel, seen: string[]) => ({
    fetchText: (path: string) => {
        seen.push(path)
        if (path.endsWith("app.json"))
            return Promise.resolve(JSON.stringify({agenta_app: 1, name: "Board", access}))
        return Promise.resolve(`<html><body>${path}</body></html>`)
    },
    fetchDataUri: () => Promise.resolve(null),
})

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

describe("swapping the entry while Run is selected", () => {
    it("drops the page the previous app had navigated to", async () => {
        const sink: {fire?: (href: string) => void} = {}
        const seen: string[] = []
        const grants = createGrantStore()
        grants.set("m1", DIR, "read", "read")

        const render = async (path: string) => {
            await act(async () => {
                root.render(
                    <HtmlAppEnvContext.Provider
                        value={{
                            enabled: true,
                            io: io("read", seen),
                            createHost: () => navHost(sink),
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
            await act(async () => {
                await Promise.resolve()
            })
        }

        await render(ENTRY)
        const run = [...container.querySelectorAll("*")].find(
            (el) => el.children.length === 0 && el.textContent?.trim() === "Run",
        )
        await act(async () => {
            run?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        })

        // The app navigates to a sibling: the view is now on the sub-page, not the entry.
        expect(sink.fire, "the view should have registered a nav handler").toBeTypeOf("function")
        await act(async () => {
            sink.fire?.("sub.html")
        })
        await act(async () => {
            await Promise.resolve()
        })
        expect(seen, "the sub-page should have been fetched").toContain(SUB)

        // The reader picks a different entry in the drive while Run stays selected.
        seen.length = 0
        await render(OTHER)

        // Nothing may be fetched for the OLD app's sub-page any more.
        expect(seen).not.toContain(SUB)
    })
})
