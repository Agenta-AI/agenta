import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

// The generated queries client is the HTTP seam: it records each request body.
const {retrieveMock} = vi.hoisted(() => ({retrieveMock: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getQueriesClient: () => ({retrieveQueryRevision: retrieveMock}),
}))

import {runQueryConfigQueryAtomFamily} from "../../src/evaluationRun"

const store = getDefaultStore()

const load = async (reference: {queryId: string; revisionId: string | null}) => {
    const queryAtom = runQueryConfigQueryAtomFamily(reference)
    const unsubscribe = store.sub(queryAtom, () => undefined)
    await vi.waitFor(() => expect(store.get(queryAtom).isSuccess).toBe(true))
    unsubscribe()
    return store.get(queryAtom).data
}

beforeEach(() => {
    retrieveMock.mockReset()
    retrieveMock.mockResolvedValue({
        query_revision: {
            data: {filtering: {operator: "and", conditions: []}, windowing: {rate: 0.5}},
        },
    })
    store.set(queryClientAtom, new QueryClient())
    store.set(projectIdAtom, "p1")
})

describe("live run query config", () => {
    it("reads the query revision the run stored, not the latest one", async () => {
        const config = await load({queryId: "q-1", revisionId: "q-rev-1"})

        expect(retrieveMock).toHaveBeenCalledWith(
            {query_revision_ref: {id: "q-rev-1"}},
            {queryParams: {project_id: "p1"}},
        )
        expect(config).toEqual({filtering: {operator: "and", conditions: []}, rate: 0.5})
    })

    it("reads the latest revision when the run stored none", async () => {
        await load({queryId: "q-2", revisionId: null})

        expect(retrieveMock).toHaveBeenCalledWith(
            {query_ref: {id: "q-2"}},
            {queryParams: {project_id: "p1"}},
        )
    })
})
