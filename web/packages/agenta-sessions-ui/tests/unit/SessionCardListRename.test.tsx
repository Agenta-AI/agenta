/**
 * Renaming a card-list row from its context menu.
 *
 * The card list is what the mobile chat panes, both agent overviews and both homes render, and
 * its "Rename" entry did nothing at all. This drives the real row: pick the entry, let the menu
 * close, and the row must swap its title for an input that saves what you type.
 */
import {act, createElement, type ReactNode} from "react"
import {createRoot, type Root} from "react-dom/client"

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const menuStub = vi.hoisted(() => ({
    onCloseAutoFocus: undefined as ((event: Event) => void) | undefined,
}))

vi.mock("@agenta/shared/utils", () => ({timeAgo: () => "now"}))
vi.mock("@agenta/sessions/row", () => ({pendingGateLabel: () => "Waiting"}))
vi.mock("@agenta/sessions/state", () => ({
    useSessionCardList: () => ({
        isPending: false,
        groups: [
            {
                key: "recent",
                label: null,
                rows: [
                    {
                        id: "session-1",
                        title: "Old name",
                        subtitle: null,
                        status: {label: "Idle", dotClassName: "", pulse: false, chipLabel: null},
                        pending: undefined,
                        agentId: "agent-1",
                        activityAt: null,
                        automation: null,
                        isPinned: false,
                        stream: {session_id: "session-1"},
                    },
                ],
            },
        ],
    }),
    useSessionPins: () => ({toggle: vi.fn()}),
}))
vi.mock("motion/react", async () => {
    const {createElement} = await import("react")
    return {
        AnimatePresence: ({children}: {children: ReactNode}) => children,
        MotionConfig: ({children}: {children: ReactNode}) => children,
        motion: new Proxy(
            {},
            {
                get: () => (props: Record<string, unknown> & {children?: ReactNode}) =>
                    createElement("div", null, props.children),
            },
        ),
    }
})
vi.mock("@agenta/ui/ui", async () => {
    const {createElement} = await import("react")
    return {
        SimpleTooltip: ({children}: {children: ReactNode}) => children,
        SkeletonBlock: () => null,
        ContextMenu: ({children}: {children: ReactNode}) => children,
        ContextMenuTrigger: ({children}: {children: ReactNode}) => children,
        ContextMenuContent: ({
            children,
            onCloseAutoFocus,
        }: {
            children: ReactNode
            onCloseAutoFocus?: (event: Event) => void
        }) => {
            menuStub.onCloseAutoFocus = onCloseAutoFocus
            return createElement("div", null, children)
        },
        ContextMenuItem: ({children, onSelect}: {children: ReactNode; onSelect?: () => void}) =>
            createElement("button", {onClick: onSelect}, children),
        ContextMenuSeparator: () => createElement("hr"),
    }
})
vi.mock("../../src/SessionAgentName", () => ({SessionAgentName: () => null}))
vi.mock("../../src/SessionAutomationKind", () => ({SessionAutomationKind: () => null}))
vi.mock("../../src/SessionPinButton", () => ({SessionPinButton: () => null}))

import {SessionCardList} from "../../src/SessionCardList"

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
    menuStub.onCloseAutoFocus = undefined
    vi.clearAllMocks()
})

const render = (onRenameRow?: (vm: {id: string}, name: string) => Promise<boolean>) =>
    act(() =>
        root.render(
            createElement(SessionCardList, {
                emptyText: "none",
                onOpenRow: vi.fn(),
                menuFor: () => [{key: "rename", label: "Rename"}],
                onMenuSelect: vi.fn(),
                onRenameRow,
            } as never),
        ),
    )

/** Picks "Rename", then runs the close the menu would run. */
const chooseRename = () => {
    const item = Array.from(container.querySelectorAll("button")).find(
        (element) => element.textContent === "Rename",
    )
    act(() => item?.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    act(() => menuStub.onCloseAutoFocus?.(new Event("closeAutoFocus", {cancelable: true})))
}

describe("SessionCardList rename", () => {
    it("shows the title and no editor at rest", () => {
        render(async () => true)

        expect(container.textContent).toContain("Old name")
        expect(container.querySelectorAll("input")).toHaveLength(0)
    })

    it("swaps the title for an editor seeded with the current name", () => {
        render(async () => true)

        chooseRename()

        const input = container.querySelector("input")
        expect(input).not.toBeNull()
        expect(input?.value).toBe("Old name")
    })

    it("saves what you type when you press Enter", async () => {
        const onRenameRow = vi.fn(async () => true)
        render(onRenameRow)
        chooseRename()

        // Re-queried at every step: the row re-renders on each keystroke and hands back a new
        // input node, so a reference held from before the change is detached and hears nothing.
        const liveInput = () => container.querySelector("input")
        const nativeValue = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
        )?.set
        act(() => {
            const input = liveInput()
            nativeValue?.call(input, "New name")
            input?.dispatchEvent(new InputEvent("input", {bubbles: true}))
        })
        await act(async () => {
            liveInput()?.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
        })

        expect(onRenameRow).toHaveBeenCalledWith(
            expect.objectContaining({id: "session-1"}),
            "New name",
        )
        expect(container.querySelectorAll("input")).toHaveLength(0)
    })

    it("leaves the row alone where the host cannot persist a rename", () => {
        render(undefined)

        chooseRename()

        expect(container.querySelectorAll("input")).toHaveLength(0)
    })
})
