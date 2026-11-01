/**
 * The latest-revision query used to disable itself once anything primed its key, and its queryFn
 * answered from that same key first. A commit's invalidation then refetched nothing, and the
 * playground kept naming the superseded revision.
 */
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const fetchWorkflowsBatch = vi.fn()

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {...actual, fetchWorkflowsBatch: (...args: unknown[]) => fetchWorkflowsBatch(...args)}
})

const {workflowLatestRevisionQueryAtomFamily} = await import("../../src/workflow/state/store")

const v1 = {id: "rev-1", workflow_id: "wf-1", version: 1, data: {}}
const v2 = {id: "rev-2", workflow_id: "wf-1", version: 2, data: {}}
const LATEST_KEY = ["workflows", "latestRevision", "wf-1", "proj-1"]

let queryClient: QueryClient
let store: ReturnType<typeof createStore>

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
    fetchWorkflowsBatch.mockReset()
    fetchWorkflowsBatch.mockResolvedValue(new Map([["wf-1", v2]]))
    queryClient = new QueryClient()
    store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, "proj-1")
    store.set(sessionAtom, true)
})

describe("workflowLatestRevisionQueryAtomFamily", () => {
    it("re-reads a primed latest revision after an invalidation", async () => {
        queryClient.setQueryData(LATEST_KEY, v1)
        const latest = workflowLatestRevisionQueryAtomFamily("wf-1")
        const unsubscribe = store.sub(latest, () => undefined)
        await settle()
        expect(store.get(latest).data?.id).toBe("rev-1")

        await queryClient.invalidateQueries({queryKey: ["workflows", "latestRevision"]})
        await settle()

        expect(fetchWorkflowsBatch.mock.calls).toEqual([["proj-1", ["wf-1"]]])
        expect(store.get(latest).data?.id).toBe("rev-2")
        unsubscribe()
    })

    it("does not fetch on mount when the primed value is still fresh", async () => {
        queryClient.setQueryData(LATEST_KEY, v1)
        const latest = workflowLatestRevisionQueryAtomFamily("wf-1")
        const unsubscribe = store.sub(latest, () => undefined)
        await settle()

        expect(fetchWorkflowsBatch.mock.calls).toEqual([])
        expect(store.get(latest).data?.id).toBe("rev-1")
        unsubscribe()
    })
})
