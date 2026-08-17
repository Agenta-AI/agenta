import {act, createElement, type ReactNode} from "react"
import {createRoot, type Root} from "react-dom/client"

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/shared/utils", () => ({timeAgo: () => "now"}))
vi.mock("@agenta/ui/ui", async () => {
    const {createElement} = await import("react")
    return {
        Button: ({children, ...props}: {children: ReactNode}) =>
            createElement("button", props, children),
        DropdownMenu: ({children}: {children: ReactNode}) => children,
        DropdownMenuContent: ({children, ...props}: {children: ReactNode}) =>
            createElement("div", props, children),
        DropdownMenuItem: ({
            children,
            onSelect,
            disabled,
        }: {
            children: ReactNode
            onSelect?: (event: MouseEvent) => void
            disabled?: boolean
        }) => createElement("button", {disabled, onClick: onSelect}, children),
        DropdownMenuSeparator: () => createElement("hr"),
        DropdownMenuTrigger: ({children}: {children: ReactNode}) => children,
    }
})
vi.mock("../../src/SessionAgentName", () => ({SessionAgentName: () => null}))
vi.mock("../../src/SessionAutomationKind", () => ({SessionAutomationKind: () => null}))
vi.mock("../../src/SessionPinButton", () => ({SessionPinButton: () => null}))
vi.mock("../../src/SessionStatusIcon", () => ({SessionStatusIcon: () => null}))

import {SessionRow} from "../../src/SessionRow"

const row = {
    id: "session-1",
    title: "Nightly digest",
    subtitle: null,
    status: {kind: "idle", chipLabel: null, chipClassName: ""},
    pending: undefined,
    agentId: "agent-1",
    activityAt: null,
    isAutomation: true,
    automation: {
        id: "schedule-1",
        kind: "schedule",
        name: "Nightly digest",
        deliveryId: "delivery-1",
    },
    deliveryId: "delivery-1",
    isPinned: false,
    stream: {session_id: "session-1"},
} as Parameters<typeof SessionRow>[0]["row"]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

function click(element: Element) {
    act(() => element.dispatchEvent(new MouseEvent("click", {bubbles: true})))
}

describe("SessionRow actions", () => {
    it("keeps body and title as primary session-open actions", () => {
        const onOpen = vi.fn()
        act(() => {
            root.render(createElement(SessionRow, {row, showAgent: false, onOpen}))
        })

        click(container.firstElementChild!)
        expect(onOpen).toHaveBeenCalledTimes(1)

        onOpen.mockClear()
        const titleButton = [...container.querySelectorAll("button")].find((button) =>
            button.textContent?.includes("Nightly digest"),
        )!
        click(titleButton)
        expect(onOpen).toHaveBeenCalledTimes(1)
    })

    it.each([
        ["open-automation", "Open automation"],
        ["view-delivery", "View delivery"],
    ])("stops %s from opening the session", (key, label) => {
        const onOpen = vi.fn()
        const onMenuSelect = vi.fn()
        act(() => {
            root.render(
                createElement(SessionRow, {
                    row,
                    showAgent: false,
                    onOpen,
                    onMenuSelect,
                    menuItems: [{key, label}],
                }),
            )
        })

        const action = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === label,
        )!
        click(action)

        expect(onMenuSelect).toHaveBeenCalledWith(key)
        expect(onOpen).not.toHaveBeenCalled()
    })
})
