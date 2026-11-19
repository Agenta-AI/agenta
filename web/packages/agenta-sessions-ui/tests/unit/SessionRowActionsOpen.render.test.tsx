// @vitest-environment jsdom
/**
 * The rail's session row menu starts with "Open" like every other session menu (approved M3 UI
 * design; QA D7): the row asks the shared verbs for an Open entry that follows its own link.
 *
 * A click on the row opens the session at once, with no double-click hold; a double click
 * renames the session that the first click opened.
 */
import {act, createElement, type MouseEvent as ReactMouseEvent, type ReactNode} from "react"

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
        const chrome = {
            menuItems,
            onMenuClick: vi.fn(() => () => undefined),
            renameSession: vi.fn(),
        }
        act(() =>
            root.render(
                createElement(SessionRowActions, {
                    session: {
                        sessionId: "s1",
                        appId: "a1",
                        name: "Chat",
                        archived: false,
                        ownerUserId: "me",
                    },
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

/** Like next/link: it calls the given onClick first and navigates unless that prevented it. */
const FakeLink = ({
    href,
    onClick,
    children,
}: {
    href: string
    onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void
    children: ReactNode
}) =>
    createElement(
        "a",
        {
            href,
            onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => {
                onClick?.(event)
                if (event.defaultPrevented) return
                event.preventDefault()
                push(href)
            },
        },
        children,
    )

const HREF = "/w/w1/p/p1/sessions/s1"

const renderRow = () => {
    const chrome = {
        menuItems: vi.fn(() => [{key: "rename", label: "Rename"}]),
        onMenuClick: vi.fn(() => () => undefined),
        renameSession: vi.fn(async () => true),
    }
    act(() =>
        root.render(
            createElement(SessionRowActions, {
                session: {sessionId: "s1", appId: "a1", name: "Chat", archived: false},
                chrome: chrome as never,
                children: createElement(FakeLink, {href: HREF, children: "Chat"}),
            }),
        ),
    )
    return host.querySelector("a") as HTMLAnchorElement
}

const click = (target: Element, detail: number) =>
    target.dispatchEvent(
        new MouseEvent("click", {bubbles: true, cancelable: true, button: 0, detail}),
    )

describe("a click on the rail's session row", () => {
    it("opens the session at once", () => {
        const anchor = renderRow()
        act(() => {
            click(anchor, 1)
        })
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(HREF)
    })

    it("renames the open session on a double click, with no second navigation", () => {
        const anchor = renderRow()
        act(() => {
            click(anchor, 1)
            click(anchor, 2)
            anchor.dispatchEvent(
                new MouseEvent("dblclick", {bubbles: true, cancelable: true, detail: 2}),
            )
        })
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(HREF)
        const input = host.querySelector("input") as HTMLInputElement | null
        expect(input).not.toBeNull()
        expect(input!.value).toBe("Chat")
    })
})
