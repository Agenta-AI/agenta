// @vitest-environment jsdom
/**
 * The rail's session row menu starts with "Open" like every other session menu (approved M3 UI
 * design; QA D7): the row asks the shared verbs for an Open entry that follows its own link.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const push = vi.hoisted(() => vi.fn())
vi.mock("next/router", () => ({useRouter: () => ({push})}))

import SessionRowActions from "../../src/SessionRowActions"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
    push.mockReset()
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
})
afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("the rail's session row menu", () => {
    it("asks for an Open entry that follows the row's link", () => {
        const menuItems = vi.fn(() => [])
        const chrome = {menuItems, onMenuClick: vi.fn(() => () => undefined), renameSession: vi.fn()}
        act(() =>
            root.render(
                createElement(SessionRowActions, {
                    session: {sessionId: "s1", appId: "a1", name: "Chat", archived: false, ownerUserId: "me"},
                    chrome: chrome as never,
                    children: createElement("a", {href: "/w/w1/p/p1/sessions/s1"}, "Chat"),
                }),
            ),
        )
        const options = (menuItems.mock.calls.at(-1) as unknown[])[1] as {onOpen?: () => void}
        expect(typeof options?.onOpen).toBe("function")
        options.onOpen!()
        expect(push).toHaveBeenCalledWith("/w/w1/p/p1/sessions/s1")
    })
})
