/**
 * `isLatestRevisionAtomFamily` decides whether editing a revision rewrites history, which gates
 * agent auto-commit. The latest-revision query has a 30s staleTime AND a disk persister, so its
 * cached head is routinely OLDER than the revision on screen — treating any id mismatch as
 * "behind" silently stopped auto-commit on a perfectly current revision.
 */
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {beforeEach, describe, expect, it} from "vitest"

import {isLatestRevisionAtomFamily} from "../../src/workflow/state/molecule"
import {workflowLocalServerDataAtomFamily} from "../../src/workflow/state/store"

const PROJECT_ID = "proj-1"
const WORKFLOW_ID = "wf-1"

const V4 = "rev-v4"
const V5 = "rev-v5"

let store: ReturnType<typeof createStore>
let queryClient: QueryClient

const seedRevision = (id: string, version: number) =>
    store.set(workflowLocalServerDataAtomFamily(id), {
        id,
        workflow_id: WORKFLOW_ID,
        version,
    } as never)

/** What the dedicated latest-revision query caches, and what the refs list caches. */
const seedHead = (head: {id: string; version: number}) => {
    queryClient.setQueryData(["workflows", "latestRevision", WORKFLOW_ID, PROJECT_ID], {
        id: head.id,
        workflow_id: WORKFLOW_ID,
        version: head.version,
    })
    queryClient.setQueryData(["workflows", "revisionsByWorkflow", WORKFLOW_ID, PROJECT_ID], {
        refs: [
            {id: V5, version: 5},
            {id: V4, version: 4},
        ],
    })
}

beforeEach(() => {
    queryClient = new QueryClient()
    store = createStore()
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, PROJECT_ID)
    store.set(sessionAtom, true)
    isLatestRevisionAtomFamily.remove(V4)
    isLatestRevisionAtomFamily.remove(V5)
    seedRevision(V4, 4)
    seedRevision(V5, 5)
})

describe("isLatestRevisionAtomFamily", () => {
    it("says latest when the revision IS the cached head", () => {
        seedHead({id: V5, version: 5})
        expect(store.get(isLatestRevisionAtomFamily(V5))).toBe(true)
    })

    it("says NOT latest when a strictly newer revision exists", () => {
        seedHead({id: V5, version: 5})
        expect(store.get(isLatestRevisionAtomFamily(V4))).toBe(false)
    })

    it("still says latest when the cached head is STALE and older", () => {
        // The regression: head cached at v4 while the user is on v5.
        seedHead({id: V4, version: 4})
        expect(store.get(isLatestRevisionAtomFamily(V5))).toBe(true)
    })

    it("assumes latest while the head is unknown", () => {
        expect(store.get(isLatestRevisionAtomFamily(V5))).toBe(true)
    })
})
