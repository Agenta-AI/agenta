import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {post} = vi.hoisted(() => ({post: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {
        ...actual,
        axios: {post},
        getAgentaApiUrl: () => "https://api.test",
    }
})

import {
    nextDeliveriesWindowing,
    TRIGGER_DELIVERIES_PAGE_SIZE,
    triggerDeliveryPagesAtomFamily,
} from "../../src/gatewayTrigger/hooks/useTriggerDeliveryPages"

const store = getDefaultStore()

const delivery = (n: number) => ({
    id: `d-${n}`,
    event_id: `evt-${n}`,
    // Newest first: a higher n is older.
    created_at: new Date(Date.UTC(2026, 10, 20) - n * 60_000).toISOString(),
    status: {type: "success", code: "200"},
})
const page = (from: number, size: number) =>
    Array.from({length: size}, (_, index) => delivery(from + index))

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
    store.set(queryClientAtom, new QueryClient({defaultOptions: {queries: {retry: false}}}))
    store.set(projectIdAtom, "proj-7")
})

describe("nextDeliveriesWindowing", () => {
    it("reads past the last row by its time and id", () => {
        const rows = page(0, 3)
        expect(nextDeliveriesWindowing({count: 3, deliveries: rows}, 3)).toEqual({
            limit: 3,
            order: "descending",
            newest: rows[2].created_at,
            next: "d-2",
        })
    })

    it("stops after a short page", () => {
        expect(nextDeliveriesWindowing({count: 2, deliveries: page(0, 2)}, 3)).toBeUndefined()
    })
})

describe("triggerDeliveryPagesAtomFamily", () => {
    it("loads a second page with the cursor of the first", async () => {
        const size = TRIGGER_DELIVERIES_PAGE_SIZE
        post.mockResolvedValueOnce({data: {count: size, deliveries: page(0, size)}})
        post.mockResolvedValueOnce({data: {count: 2, deliveries: page(size, 2)}})

        const atom = triggerDeliveryPagesAtomFamily({kind: "schedule", id: "sch-1"})
        const unsub = store.sub(atom, () => {})

        await waitFor(() => expect(store.get(atom).data?.pages).toHaveLength(1))
        expect(post.mock.calls[0][1]).toEqual({
            delivery: {schedule_id: "sch-1"},
            windowing: {limit: size, order: "descending"},
        })
        expect(store.get(atom).hasNextPage).toBe(true)

        await store.get(atom).fetchNextPage()

        await waitFor(() => expect(store.get(atom).data?.pages).toHaveLength(2))
        const last = page(0, size)[size - 1]
        expect(post.mock.calls[1][1]).toEqual({
            delivery: {schedule_id: "sch-1"},
            windowing: {limit: size, order: "descending", newest: last.created_at, next: last.id},
        })
        expect(store.get(atom).data?.pages.flatMap((p) => p.deliveries)).toHaveLength(size + 2)
        expect(store.get(atom).hasNextPage).toBe(false)
        unsub()
    })
})
