// @vitest-environment jsdom
import {
    nearestSurvivingTab,
    renderedSessionTabsAtomFamily,
    sessionTabScope,
} from "@agenta/sessions/state"
import {QueryClient, QueryClientProvider, useQuery} from "@tanstack/react-query"
import {renderHook, waitFor} from "@testing-library/react"
import {createStore, Provider} from "jotai"
import {describe, expect, it, vi} from "vitest"

import {useAgentSessionOrder} from "@/features/agent-layout/useAgentSessionOrder"

const lastArgs = vi.hoisted(() => ({limit: undefined as number | undefined}))
vi.mock("@agenta/sessions/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sessions/state")>()),
    useSessionCardList: (args: {limit?: number}) => ({
        // Records the limit, so the test can see that revealed rows are not cut.
        limit: (lastArgs.limit = args.limit),
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
        // Rows the menu revealed with "Show more" stay in the order: no cut at the menu's 20.
        expect(lastArgs.limit).toBeGreaterThan(20)
    })

    it("reports a failed session-list request of this agent that a list reads now", async () => {
        const {client, hook} = setup()
        expect(hook.result.current.failed).toBe(false)
        // Another agent's failure does not count.
        renderHook(
            () =>
                useQuery({
                    queryKey: ["session-list", "proj", "", "agent-2"],
                    queryFn: () => Promise.reject(new Error("down")),
                    retry: false,
                }),
            {
                wrapper: ({children}) => (
                    <QueryClientProvider client={client}>{children}</QueryClientProvider>
                ),
            },
        )
        await new Promise((r) => setTimeout(r, 20))
        expect(hook.result.current.failed).toBe(false)
        let fail = true
        const failing = renderHook(
            () =>
                useQuery({
                    queryKey: ["session-list", "proj", "", "agent-1"],
                    queryFn: () => (fail ? Promise.reject(new Error("down")) : Promise.resolve([])),
                    retry: false,
                }),
            {
                wrapper: ({children}) => (
                    <QueryClientProvider client={client}>{children}</QueryClientProvider>
                ),
            },
        )
        await waitFor(() => expect(hook.result.current.failed).toBe(true))
        // Retry refetches the failed request; once it answers, the error goes.
        fail = false
        hook.result.current.retry()
        await waitFor(() => expect(hook.result.current.failed).toBe(false))
        // A failed request no list reads any more does not count.
        fail = true
        await client.refetchQueries({queryKey: ["session-list"]}).catch(() => undefined)
        await waitFor(() => expect(hook.result.current.failed).toBe(true))
        failing.unmount()
        await waitFor(() => expect(hook.result.current.failed).toBe(false))
    })
})
