/**
 * The latest-revision query of a test set asks the server: an older revision in the cache is not
 * the latest, and an invalidation after a commit reads the new one.
 */
import {sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fetchLatestRevisionsBatch = vi.fn()

vi.mock("../../src/testset/api", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {
        ...actual,
        fetchLatestRevisionsBatch: (...args: unknown[]) => fetchLatestRevisionsBatch(...args),
    }
})

const {latestRevisionQueryAtomFamily, requestLatestRevisionAtom} =
    await import("../../src/testset/state/store")

const v2 = {id: "rev-2", testset_id: "ts-1", version: 2}
const v5 = {id: "rev-5", testset_id: "ts-1", version: 5}
const v6 = {id: "rev-6", testset_id: "ts-1", version: 6}

let queryClient: QueryClient
// The store the app uses.
const store = getDefaultStore()

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
    fetchLatestRevisionsBatch.mockReset()
    queryClient = new QueryClient()
    store.set(queryClientAtom, queryClient)
    store.set(sessionAtom, true)
})

describe("latestRevisionQueryAtomFamily", () => {
    it("asks the server even when an older revision of the test set is in the cache", async () => {
        fetchLatestRevisionsBatch.mockResolvedValue(new Map([["ts-1", v5]]))
        queryClient.setQueryData(["revision", "proj-1", "rev-2"], v2)
        store.set(requestLatestRevisionAtom, {testsetId: "ts-1", projectId: "proj-1"})
        const latest = latestRevisionQueryAtomFamily("ts-1")
        const unsubscribe = store.sub(latest, () => undefined)
        await settle()

        expect(fetchLatestRevisionsBatch.mock.calls).toEqual([["proj-1", ["ts-1"]]])
        expect(store.get(latest).data?.id).toBe("rev-5")
        unsubscribe()
    })

    it("reads the server again after an invalidation", async () => {
        fetchLatestRevisionsBatch.mockResolvedValue(new Map([["ts-1", v5]]))
        store.set(requestLatestRevisionAtom, {testsetId: "ts-1", projectId: "proj-1"})
        const latest = latestRevisionQueryAtomFamily("ts-1")
        const unsubscribe = store.sub(latest, () => undefined)
        await settle()
        expect(store.get(latest).data?.id).toBe("rev-5")

        fetchLatestRevisionsBatch.mockResolvedValue(new Map([["ts-1", v6]]))
        await queryClient.invalidateQueries({queryKey: ["latest-revision"]})
        await settle()

        expect(fetchLatestRevisionsBatch).toHaveBeenCalledTimes(2)
        expect(store.get(latest).data?.id).toBe("rev-6")
        unsubscribe()
    })
})
