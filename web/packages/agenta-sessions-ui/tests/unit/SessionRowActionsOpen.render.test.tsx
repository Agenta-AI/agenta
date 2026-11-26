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

// The rename a double click asks for outlives its row for a few seconds (the rail can remount),
// so each test uses its own session.
const renderRow = (sessionId: string) => {
    const chrome = {
        menuItems: vi.fn(() => [{key: "rename", label: "Rename"}]),
        onMenuClick: vi.fn(() => () => undefined),
        renameSession: vi.fn(async () => true),
    }
    act(() =>
        root.render(
            createElement(SessionRowActions, {
                session: {sessionId, appId: "a1", name: "Chat", archived: false},
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
        const anchor = renderRow("s-open")
        act(() => {
            click(anchor, 1)
        })
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(HREF)
    })

    it("renames the open session on a double click, with no second navigation", () => {
        const anchor = renderRow("s-double")
        act(() => {
            click(anchor, 1)
            click(anchor, 2)
        })
        expect(push).toHaveBeenCalledTimes(1)
        expect(push).toHaveBeenCalledWith(HREF)
        const input = host.querySelector("input") as HTMLInputElement | null
        expect(input).not.toBeNull()
        expect(input!.value).toBe("Chat")
    })

    it("renames on the second click when the first click's navigation replaced the row", () => {
        const anchor = renderRow("s-replaced")
        act(() => {
            click(anchor, 1)
        })
        // The new page mounts a new rail: a new row gets only the second click.
        act(() => root.unmount())
        root = createRoot(host)
        const next = renderRow("s-replaced")
        act(() => {
            click(next, 2)
        })
        expect(push).toHaveBeenCalledTimes(1)
        expect(host.querySelector("input")).not.toBeNull()
    })

    it("keeps the rename when the navigation replaces the row after the double click", () => {
        const anchor = renderRow("s-after")
        act(() => {
            click(anchor, 1)
            click(anchor, 2)
        })
        act(() => root.unmount())
        root = createRoot(host)
        renderRow("s-after")
        expect(host.querySelector("input")).not.toBeNull()
    })

    it("does not rename a row that mounts later without a double click", () => {
        renderRow("s-later")
        expect(host.querySelector("input")).toBeNull()
    })
})
