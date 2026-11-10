import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {axiosPostMock} = vi.hoisted(() => ({axiosPostMock: vi.fn()}))

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/shared/api")>()
    return {...actual, axios: {...actual.axios, post: axiosPostMock}}
})

import {fetchWorkflowRevisionsByIdsBatch} from "../../src/workflow/api/api"
import {workflowIncludeArchivedAtom, workflowQueryAtomFamily} from "../../src/workflow/state/store"

const PROJECT_ID = "proj-1"

beforeEach(() => {
    axiosPostMock.mockReset()
    axiosPostMock.mockResolvedValue({data: {count: 0, workflow_revisions: []}})
})

describe("fetchWorkflowRevisionsByIdsBatch", () => {
    it("does not ask for archived items by default", async () => {
        await fetchWorkflowRevisionsByIdsBatch(PROJECT_ID, ["rev-1"])
        expect(axiosPostMock.mock.calls[0][1]).not.toHaveProperty("include_archived")
    })

    it("asks for archived items when the caller does", async () => {
        await fetchWorkflowRevisionsByIdsBatch(PROJECT_ID, ["rev-1"], {includeArchived: true})
        expect(axiosPostMock.mock.calls[0][1]).toMatchObject({include_archived: true})
    })
})

describe("workflowQueryAtomFamily", () => {
    const run = async (includeArchived: boolean, revisionId: string) => {
        const store = createStore()
        store.set(queryClientAtom, new QueryClient())
        store.set(projectIdAtom, PROJECT_ID)
        store.set(sessionAtom, true)
        store.set(workflowIncludeArchivedAtom, includeArchived)
        const unsub = store.sub(workflowQueryAtomFamily(revisionId), () => {})
        await vi.waitFor(() => expect(axiosPostMock).toHaveBeenCalled())
        unsub()
    }

    it("fetches archived revisions when the flag is on", async () => {
        await run(true, "rev-archived")
        expect(axiosPostMock.mock.calls[0][1]).toMatchObject({include_archived: true})
    })

    it("leaves archived items out when the flag is off", async () => {
        await run(false, "rev-active")
        expect(axiosPostMock.mock.calls[0][1]).not.toHaveProperty("include_archived")
    })

    it("a revision cached as missing with the flag off is fetched again with the flag on", async () => {
        const queryClient = new QueryClient()
        const store = createStore()
        store.set(queryClientAtom, queryClient)
        store.set(projectIdAtom, PROJECT_ID)
        store.set(sessionAtom, true)

        store.set(workflowIncludeArchivedAtom, false)
        const first = store.sub(workflowQueryAtomFamily("rev-archived"), () => {})
        await vi.waitFor(() => expect(axiosPostMock).toHaveBeenCalledTimes(1))
        first()

        axiosPostMock.mockResolvedValue({
            data: {count: 1, workflow_revisions: [{id: "rev-archived", workflow_id: "wf-1"}]},
        })
        store.set(workflowIncludeArchivedAtom, true)
        const second = store.sub(workflowQueryAtomFamily("rev-archived"), () => {})
        await vi.waitFor(() => expect(axiosPostMock).toHaveBeenCalledTimes(2))
        expect(axiosPostMock.mock.calls[1][1]).toMatchObject({include_archived: true})
        second()
    })
})
