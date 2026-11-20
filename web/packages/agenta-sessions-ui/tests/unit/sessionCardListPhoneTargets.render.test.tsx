/**
 * @vitest-environment jsdom
 *
 * The card list's touch targets on a phone: "Show more" is 44 px high, and a row's 20 px title
 * button reaches over the whole row (taller than 44 px), which opens on a tap anywhere.
 */
import {act, createElement, type ReactNode} from "react"
import {createRoot, type Root} from "react-dom/client"

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/shared/utils", () => ({timeAgo: () => "now"}))
vi.mock("@agenta/sessions/row", () => ({pendingGateLabel: () => "Waiting"}))
vi.mock("@agenta/sessions/state", () => ({
    useSessionCardList: () => ({
        isPending: false,
        isEmpty: false,
        canShowMore: true,
        showMore: () => undefined,
        groups: [
            {
                key: "recent",
                label: null,
                rows: [
                    {
                        id: "session-1",
                        title: "Refund question",
                        subtitle: "Asked about a refund",
                        status: {label: "Idle", dotClassName: "", pulse: false, chipLabel: null},
                        pending: undefined,
                        agentId: "agent-1",
                        activityAt: null,
                        automation: null,
                        isPinned: false,
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
vi.mock("@agenta/ui/ui", () => ({
    SimpleTooltip: ({children}: {children: ReactNode}) => children,
    SkeletonBlock: () => null,
    ContextMenu: ({children}: {children: ReactNode}) => children,
    ContextMenuTrigger: ({children}: {children: ReactNode}) => children,
    ContextMenuContent: () => null,
    ContextMenuItem: () => null,
    ContextMenuSeparator: () => null,
}))
vi.mock("../../src/SessionAgentName", () => ({SessionAgentName: () => null}))
vi.mock("../../src/SessionAutomationKind", () => ({SessionAutomationKind: () => null}))
vi.mock("../../src/SessionPinButton", () => ({SessionPinButton: () => null}))

import {SessionCardList} from "../../src/SessionCardList"

let container: HTMLDivElement
let root: Root
const onOpenRow = vi.fn()

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(createElement(SessionCardList, {emptyText: "none", onOpenRow} as never)))
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
})

const buttons = () => Array.from(container.querySelectorAll("button"))

describe("SessionCardList on a phone", () => {
    it("draws Show more 44 px high on a phone", () => {
        const showMore = buttons().find((button) => button.textContent?.includes("Show more"))
        expect(showMore?.className.split(/\s+/)).toContain("max-md:min-h-11")
    })

    it("gives the title button the whole row as its touch area on a phone", () => {
        const title = buttons().find((button) => button.textContent?.includes("Refund question"))
        const classes = title?.className.split(/\s+/) ?? []
        expect(classes).toEqual(
            expect.arrayContaining(["max-md:after:absolute", "max-md:after:inset-0"]),
        )
        const row = title?.parentElement
        expect(row?.className.split(/\s+/)).toContain("max-md:relative")
        // The trailing controls stay above the title's area, so the pin keeps its own tap.
        expect(row?.lastElementChild?.className.split(/\s+/)).toContain("max-md:relative")
    })

    it("keeps the row's own click: a tap outside the title button opens the row", () => {
        const title = buttons().find((button) => button.textContent?.includes("Refund question"))
        const row = title?.parentElement
        expect(row?.tagName).toBe("DIV")
        act(() => row?.dispatchEvent(new MouseEvent("click", {bubbles: true})))
        expect(onOpenRow).toHaveBeenCalledTimes(1)
        expect(onOpenRow.mock.calls[0][0]).toMatchObject({id: "session-1"})
    })
})
