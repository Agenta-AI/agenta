import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("../../src/session/api/api", () => ({queryInteractions: vi.fn()}))

import {
    revalidateSessionInteractionsAtom,
    sessionInteractionRowsQueryKey,
} from "../../src/session/state/interactionStatus"

const key = sessionInteractionRowsQueryKey("project-id", "session-id")

describe("revalidateSessionInteractionsAtom with olderThanMs", () => {
    let client: QueryClient
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        vi.useFakeTimers()
        client = new QueryClient()
        store = createStore()
        store.set(projectIdAtom, "project-id")
        store.set(queryClientAtom, client)
        client.setQueryData(key, [])
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("leaves rows read inside the window as they are", async () => {
        vi.advanceTimersByTime(1_000)
        await store.set(revalidateSessionInteractionsAtom, "session-id", {olderThanMs: 2_000})
        expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    })

    it("marks older rows stale, so the next read asks the server", async () => {
        vi.advanceTimersByTime(2_500)
        await store.set(revalidateSessionInteractionsAtom, "session-id", {olderThanMs: 2_000})
        expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    })

    it("keeps rows marked stale by another caller stale inside the window", async () => {
        await client.invalidateQueries({queryKey: key, refetchType: "none"})
        await store.set(revalidateSessionInteractionsAtom, "session-id", {olderThanMs: 2_000})
        expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    })

    it("always marks the rows stale without the option", async () => {
        await store.set(revalidateSessionInteractionsAtom, "session-id")
        expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    })
})
