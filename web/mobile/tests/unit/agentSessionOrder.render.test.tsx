// @vitest-environment jsdom
import {
    nearestSurvivingTab,
    renderedSessionTabsAtomFamily,
    sessionTabScope,
} from "@agenta/sessions/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {act, renderHook} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {describe, expect, it, vi} from "vitest"

import {useAgentSessionOrder} from "@/features/agent-layout/useAgentSessionOrder"

vi.mock("@agenta/sessions/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sessions/state")>()),
    useSessionCardList: () => ({
        groups: [
            {key: "pinned", rows: [{id: "s-2"}]},
            {key: "recent", rows: [{id: "s-1"}, {id: "s-3"}]},
        ],
    }),
}))

const setup = () => {
    const store = createStore()
    const client = new QueryClient()
    const hook = renderHook(() => useAgentSessionOrder("agent-1"), {
        wrapper: ({children}) => (
            <QueryClientProvider client={client}>
                <Provider store={store}>{children}</Provider>
            </QueryClientProvider>
        ),
    })
    return {store, client, hook}
}

describe("the agent's session order", () => {
    it("publishes the menu's order where leaving a session reads it, so archive moves to the next one", () => {
        const {store} = setup()
        const order = store.get(renderedSessionTabsAtomFamily(sessionTabScope("agent-1")))
        expect(order).toEqual(["s-2", "s-1", "s-3"])
        expect(nearestSurvivingTab(order, new Set(["s-1"]), "s-1")).toBe("s-3")
    })

    it("reports a failed session-list request of this agent, and only of this agent", async () => {
        const {client, hook} = setup()
        expect(hook.result.current.failed).toBe(false)
        await act(async () => {
            await client
                .fetchQuery({
                    queryKey: ["session-list", "proj", "", "agent-2"],
                    queryFn: () => Promise.reject(new Error("down")),
                    retry: false,
                })
                .catch(() => undefined)
        })
        expect(hook.result.current.failed).toBe(false)
        await act(async () => {
            await client
                .fetchQuery({
                    queryKey: ["session-list", "proj", "", "agent-1"],
                    queryFn: () => Promise.reject(new Error("down")),
                    retry: false,
                })
                .catch(() => undefined)
        })
        expect(hook.result.current.failed).toBe(true)
    })
})
