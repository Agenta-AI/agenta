// @vitest-environment jsdom
import {
    nearestSurvivingTab,
    renderedSessionTabsAtomFamily,
    sessionTabScope,
} from "@agenta/sessions/state"
import {renderHook} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {describe, expect, it, vi} from "vitest"

import {useAgentSessionOrder} from "@/features/agent-layout/useAgentSessionOrder"

const list = vi.hoisted(() => ({
    pages: [{sessions: [{session_id: "s-2"}, {session_id: "s-1"}, {session_id: "s-3"}]}],
    isError: false,
}))
vi.mock("@agenta/sessions/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sessions/state")>()),
    useSessionList: () => ({data: {pages: list.pages}, isError: list.isError, refetch: vi.fn()}),
}))

describe("the agent's session order", () => {
    it("publishes the list order where leaving a session reads it, so archive moves to the next one", () => {
        const store = createStore()
        renderHook(() => useAgentSessionOrder("agent-1"), {
            wrapper: ({children}) => <Provider store={store}>{children}</Provider>,
        })
        const order = store.get(renderedSessionTabsAtomFamily(sessionTabScope("agent-1")))
        expect(order).toEqual(["s-2", "s-1", "s-3"])
        expect(nearestSurvivingTab(order, new Set(["s-1"]), "s-1")).not.toBeNull()
    })

    it("reports a failed list only when nothing loaded", () => {
        list.isError = true
        list.pages = []
        const {result} = renderHook(() => useAgentSessionOrder("agent-1"), {
            wrapper: ({children}) => <Provider store={createStore()}>{children}</Provider>,
        })
        expect(result.current.failed).toBe(true)
    })
})
