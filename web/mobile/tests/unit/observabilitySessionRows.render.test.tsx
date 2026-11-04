// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@agenta/observability", () => ({
    useSessions: () => ({
        sessionIds: ["session-a", "session-b"],
        isLoading: false,
        isFetchingMore: false,
        hasMoreSessions: false,
        fetchMoreSessions: vi.fn(),
        filters: [],
        setFilters: vi.fn(),
    }),
}))
// The list shell renders its rows; the cells need the session atoms, so they render nothing.
vi.mock("@agenta/observability-ui", () => {
    const Cell = () => null
    return {
        ObservabilityList: ({
            items,
            renderItem,
        }: {
            items: string[]
            renderItem: (item: string) => ReactNode
        }) => (
            <>
                {items.map((item) => (
                    <div key={item}>{renderItem(item)}</div>
                ))}
            </>
        ),
        EndTimeCell: Cell,
        FirstInputCell: Cell,
        LastOutputCell: Cell,
        SessionDurationCell: Cell,
        SessionIdCell: ({sessionId}: {sessionId: string}) => <span>{sessionId}</span>,
        TotalCostCell: Cell,
        TracesCountCell: Cell,
    }
})

import {SessionsList} from "@/features/observability/SessionsList"

describe("SessionsList", () => {
    let root: Root
    let host: HTMLDivElement
    const onOpenSession = vi.fn()

    const card = (sessionId: string) =>
        [...document.querySelectorAll<HTMLElement>("[role='button']")].find((el) =>
            el.textContent?.includes(sessionId),
        )

    beforeEach(() => {
        onOpenSession.mockReset()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        act(() => root.render(<SessionsList onOpenSession={onOpenSession} />))
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Clicking a session card opens that session", () => {
        act(() => card("session-b")?.click())
        expect(onOpenSession).toHaveBeenCalledWith("session-b")
    })

    it("Enter and Space on a session card open it", () => {
        const target = card("session-a")
        for (const key of ["Enter", " "]) {
            act(() => {
                target?.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true}))
            })
        }
        expect(onOpenSession).toHaveBeenCalledTimes(2)
        expect(onOpenSession).toHaveBeenCalledWith("session-a")
    })
})
