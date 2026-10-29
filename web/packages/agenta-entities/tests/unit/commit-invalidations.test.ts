/**
 * What a commit must invalidate.
 *
 * The revision picker lists a VARIANT's revisions (`["workflows", "revisions", variantId, …]`),
 * while the commit only busted the by-WORKFLOW list. The revision it had just created was
 * therefore missing from the dropdown — visible as a header reading `v9 · Saved` above a picker
 * that stops at v8. Rare enough to miss with a manual Commit; constant once every edit commits.
 */
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {QueryClient} from "@tanstack/react-query"
import {beforeEach, describe, expect, it, vi} from "vitest"

const commitApi = vi.fn()

vi.mock("../../src/workflow/api", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {...actual, commitWorkflowRevisionApi: (...args: unknown[]) => commitApi(...args)}
})

import {projectIdAtom} from "@agenta/shared/state"

import {commitWorkflowRevisionAtom} from "../../src/workflow/state/commit"
import {
    updateWorkflowDraftAtom,
    workflowLocalServerDataAtomFamily,
} from "../../src/workflow/state/store"

const SOURCE = "local-draft-source"
const VARIANT = "variant-1"
const WORKFLOW = "wf-1"

// The invalidation helpers resolve the DEFAULT store, so the test drives that one.
const store = getDefaultStore()
let invalidateSpy: ReturnType<typeof vi.fn>

const invalidatedKeys = () => invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))

let queryClient: QueryClient
const VARIANT_KEY = ["workflows", "revisions", VARIANT, "proj-1"]
const WORKFLOW_KEY = ["workflows", "revisionsByWorkflow", WORKFLOW, "proj-1"]
type RefList = {count: number; refs: {id: string; version: number | null}[]}

beforeEach(() => {
    commitApi.mockReset()
    commitApi.mockResolvedValue({
        id: "new-revision",
        workflow_id: WORKFLOW,
        workflow_variant_id: VARIANT,
        version: 9,
        data: {parameters: {}},
    })

    queryClient = new QueryClient()
    invalidateSpy = vi.fn()
    queryClient.invalidateQueries = invalidateSpy as never
    store.set(queryClientAtom, queryClient)
    store.set(projectIdAtom, "proj-1")
    store.set(workflowLocalServerDataAtomFamily(SOURCE), {
        id: SOURCE,
        workflow_id: WORKFLOW,
        workflow_variant_id: VARIANT,
        data: {parameters: {agent: {instructions: "server"}}},
    } as never)
    store.set(updateWorkflowDraftAtom, SOURCE, {
        data: {parameters: {agent: {instructions: "edited"}}},
    } as never)
})

describe("commitWorkflowRevisionAtom cache invalidation", () => {
    it("busts the by-VARIANT revisions list the picker reads", async () => {
        const result = await store.set(commitWorkflowRevisionAtom, {revisionId: SOURCE})
        expect(result.success).toBe(true)
        expect(invalidatedKeys().join("|")).toContain(`["workflows","revisions","${VARIANT}"`)
    })

    it("still busts the by-WORKFLOW list", async () => {
        await store.set(commitWorkflowRevisionAtom, {revisionId: SOURCE})
        expect(invalidatedKeys().join("|")).toContain(
            `["workflows","revisionsByWorkflow","${WORKFLOW}"`,
        )
    })
})

describe("the revision the commit just created", () => {
    // Invalidation alone leaves the dropdown a refetch behind. These lists are thin refs, and the
    // commit response carries everything they need, so seed them instead of waiting.
    beforeEach(() => {
        const before: RefList = {count: 1, refs: [{id: "old-revision", version: 8}]}
        queryClient.setQueryData(VARIANT_KEY, before)
        queryClient.setQueryData(WORKFLOW_KEY, before)
    })

    it("is in the by-variant list at once — the desktop picker", async () => {
        await store.set(commitWorkflowRevisionAtom, {revisionId: SOURCE})
        const list = queryClient.getQueryData<RefList>(VARIANT_KEY)
        expect(list?.refs.map((r) => r.id)).toEqual(["new-revision", "old-revision"])
    })

    it("is in the by-workflow list at once — the mobile top bar", async () => {
        await store.set(commitWorkflowRevisionAtom, {revisionId: SOURCE})
        const list = queryClient.getQueryData<RefList>(WORKFLOW_KEY)
        expect(list?.refs.map((r) => r.id)).toEqual(["new-revision", "old-revision"])
    })

    it("is not duplicated when the list already carries it", async () => {
        queryClient.setQueryData(VARIANT_KEY, {
            count: 1,
            refs: [{id: "new-revision", version: 9}],
        } satisfies RefList)
        await store.set(commitWorkflowRevisionAtom, {revisionId: SOURCE})
        expect(queryClient.getQueryData<RefList>(VARIANT_KEY)?.refs).toHaveLength(1)
    })

    it("leaves an unfetched list alone, so nothing renders a one-item history", async () => {
        queryClient.removeQueries({queryKey: VARIANT_KEY})
        await store.set(commitWorkflowRevisionAtom, {revisionId: SOURCE})
        expect(queryClient.getQueryData(VARIANT_KEY)).toBeUndefined()
    })
})
