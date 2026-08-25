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

beforeEach(() => {
    commitApi.mockReset()
    commitApi.mockResolvedValue({id: "new-revision", workflow_id: WORKFLOW, data: {parameters: {}}})

    const qc = new QueryClient()
    invalidateSpy = vi.fn()
    qc.invalidateQueries = invalidateSpy as never
    store.set(queryClientAtom, qc)
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
