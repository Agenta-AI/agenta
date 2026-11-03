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

import {triggerRecentDeliveriesAtomFamily} from "../../src/gatewayTrigger/hooks/useTriggerDeliveries"

const store = getDefaultStore()

const delivery = (id: string, createdAt: string) => ({
    id,
    event_id: `evt-${id}`,
    created_at: createdAt,
    status: {type: "success", code: "200"},
})

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

describe("triggerRecentDeliveriesAtomFamily", () => {
    it("reads the newest runs in one request, capped one past the shown count", async () => {
        post.mockResolvedValue({
            data: {count: 1, deliveries: [delivery("old", "2026-06-01T00:00:00.000Z")]},
        })

        const atom = triggerRecentDeliveriesAtomFamily({kind: "schedule", id: "sch-1"})
        const unsub = store.sub(atom, () => {})

        await waitFor(() =>
            expect(store.get(atom).data?.deliveries.map((d) => d.id)).toEqual(["old"]),
        )
        expect(post.mock.calls.map(([url, body, opts]) => [url, body, opts.params])).toEqual([
            [
                "https://api.test/triggers/deliveries/query",
                {
                    delivery: {schedule_id: "sch-1"},
                    windowing: {limit: 101, order: "descending"},
                },
                {project_id: "proj-7"},
            ],
        ])
        unsub()
    })
})
