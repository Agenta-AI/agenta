/**
 * A connection's row menu offers Revoke and Delete only to someone allowed to change the
 * connection. A read-only member on the project's rows must not be offered either.
 */
import {act, createElement} from "react"

import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {ConnectionRowMenu} from "../../src/DrillInView/SchemaControls/agentTemplate/ConnectionRowMenu"

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

const render = async (props: Parameters<typeof ConnectionRowMenu>[0]) => {
    await act(async () => root.render(createElement(ConnectionRowMenu, props)))
}

const open = async () => {
    await act(async () => {
        host.querySelector("button")?.dispatchEvent(
            new MouseEvent("pointerdown", {bubbles: true, cancelable: true, button: 0}),
        )
    })
}

const items = () =>
    Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) =>
        item.textContent?.trim(),
    )

describe("ConnectionRowMenu", () => {
    it("offers Revoke and Delete when the person may change the connection", async () => {
        await render({onRefresh: vi.fn(), onRevoke: vi.fn(), onDelete: vi.fn()})
        await open()
        expect(items()).toEqual(["Refresh", "Revoke", "Delete"])
    })

    it("offers only Refresh to a read-only member", async () => {
        await render({onRefresh: vi.fn()})
        await open()
        expect(items()).toEqual(["Refresh"])
    })
})
