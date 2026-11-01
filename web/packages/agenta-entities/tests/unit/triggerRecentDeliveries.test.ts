import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const {post} = vi.hoisted(() => ({post: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        axios: {post},
        getAgentaApiUrl: () => "https://api.test",
    }
})

import {triggerRecentDeliveriesAtomFamily} from "../../src/gatewayTrigger/hooks/useTriggerDeliveries"

const store = getDefaultStore()

const delivery = (id: string, createdAt: string) => ({
    id,
    event_id: `evt-${id}`,
    created_at: createdAt,
    status: {type: "success", code: "200"},
})

// Counts tries, not wall time: `Date` is frozen in these tests.
async function waitFor(assertion: () => void, tries = 300) {
    let lastError: unknown
    for (let i = 0; i < tries; i++) {
        try {
            assertion()
            return
        } catch (error) {
            lastError = error
            await new Promise((resolve) => setTimeout(resolve, 10))
        }
    }
    throw lastError
}

beforeEach(() => {
    post.mockReset()
    vi.useFakeTimers({toFake: ["Date"]})
    vi.setSystemTime(new Date("2026-11-02T12:00:00.000Z"))
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, "proj-7")
})

afterEach(() => {
    vi.useRealTimers()
})

describe("triggerRecentDeliveriesAtomFamily", () => {
    it("reads the last 30 days, newest first, capped one past the shown count", async () => {
        post.mockResolvedValue({
            data: {count: 1, deliveries: [delivery("d1", "2026-11-01T00:00:00.000Z")]},
        })

        const atom = triggerRecentDeliveriesAtomFamily({kind: "schedule", id: "sch-1"})
        const unsub = store.sub(atom, () => {})

        await waitFor(() =>
            expect(store.get(atom).data?.deliveries.map((d) => d.id)).toEqual(["d1"]),
        )
        expect(post.mock.calls.map(([url, body, opts]) => [url, body, opts.params])).toEqual([
            [
                "https://api.test/triggers/deliveries/query",
                {
                    delivery: {schedule_id: "sch-1"},
                    windowing: {
                        oldest: "2026-10-03T12:00:00.000Z",
                        limit: 101,
                        order: "descending",
                    },
                },
                {project_id: "proj-7"},
            ],
        ])
        unsub()
    })

    it("falls back to the single newest run when the last 30 days are empty", async () => {
        post.mockResolvedValueOnce({data: {count: 0, deliveries: []}}).mockResolvedValueOnce({
            data: {count: 1, deliveries: [delivery("old", "2026-06-01T00:00:00.000Z")]},
        })

        const atom = triggerRecentDeliveriesAtomFamily({kind: "subscription", id: "sub-9"})
        const unsub = store.sub(atom, () => {})

        await waitFor(() =>
            expect(store.get(atom).data?.deliveries.map((d) => d.id)).toEqual(["old"]),
        )
        expect(post.mock.calls.map(([, body]) => body)).toEqual([
            {
                delivery: {subscription_id: "sub-9"},
                windowing: {oldest: "2026-10-03T12:00:00.000Z", limit: 101, order: "descending"},
            },
            {delivery: {subscription_id: "sub-9"}, windowing: {limit: 1, order: "descending"}},
        ])
        unsub()
    })
})
