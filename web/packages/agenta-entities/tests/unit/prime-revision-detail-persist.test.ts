/**
 * Revisions are immutable by id, so a list refetch that primes a revision the detail cache already
 * holds must not write it to IndexedDB again. An agent with N revisions paid N writes per refetch.
 */
import {projectIdAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const persisted: [unknown[], unknown][] = []

vi.mock("@agenta/shared/api/persist", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, Record<string, unknown>>
    return {
        ...actual,
        immutablePersister: {
            ...actual.immutablePersister,
            persistQueryByKey: async (queryKey: unknown[], queryClient: QueryClient) => {
                persisted.push([queryKey, queryClient.getQueryData(queryKey)])
            },
        },
    }
})

const {primeWorkflowRevisionDetailCacheImperative} = await import("../../src/workflow/state/store")

let queryClient: QueryClient

beforeEach(() => {
    persisted.length = 0
    queryClient = new QueryClient()
    getDefaultStore().set(queryClientAtom, queryClient)
    getDefaultStore().set(projectIdAtom, "proj-1")
})

describe("primeWorkflowRevisionDetailCacheImperative", () => {
    it("writes a revision to IndexedDB once, however often a list primes it", () => {
        const revision = {id: "rev-1", workflow_id: "wf-1", version: 3, data: {parameters: {a: 1}}}

        primeWorkflowRevisionDetailCacheImperative(revision as never)
        primeWorkflowRevisionDetailCacheImperative({...revision} as never)

        expect(persisted).toEqual([[["workflows", "revision", "rev-1", "proj-1"], revision]])
    })

    it("still writes when the cached entry for that id had no body yet", () => {
        queryClient.setQueryData(["workflows", "revision", "rev-1", "proj-1"], {id: "rev-1"})
        const revision = {id: "rev-1", workflow_id: "wf-1", version: 3, data: {parameters: {}}}

        primeWorkflowRevisionDetailCacheImperative(revision as never)

        expect(persisted).toEqual([[["workflows", "revision", "rev-1", "proj-1"], revision]])
    })
})
