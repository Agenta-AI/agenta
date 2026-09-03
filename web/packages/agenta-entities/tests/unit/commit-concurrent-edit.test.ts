/**
 * `commitWorkflowRevisionAtom` must not destroy an edit made while its request is in flight.
 *
 * The commit snapshots its payload BEFORE the network call and discards the draft AFTER it, so
 * anything typed in between is in neither the new revision nor — once discarded — anywhere else.
 * The draft is its only copy. A manual Commit button made that window rare; auto-commit (#6126)
 * fires on idle, so the user is routinely still editing when the request lands.
 *
 * The guarantee asserted here is the one that matters: the concurrent edit survives somewhere.
 * Whether it is carried onto the new revision or left on the old one depends on the new
 * revision's server baseline being available, which is an optimisation — never destroying it is
 * the invariant.
 */
import {createStore} from "jotai"
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
    workflowDraftAtomFamily,
    workflowLocalServerDataAtomFamily,
} from "../../src/workflow/state/store"

// A local-draft id lets the test own the server baseline outright, with no query layer.
const SOURCE = "local-draft-source"
const NEW_REVISION = "new-revision-id"

let store: ReturnType<typeof createStore>

const draftParams = (id: string) => {
    const draft = store.get(workflowDraftAtomFamily(id)) as
        | {data?: {parameters?: Record<string, unknown>}}
        | null
        | undefined
    return draft?.data?.parameters
}

beforeEach(() => {
    commitApi.mockReset()
    store = createStore()
    store.set(projectIdAtom, "proj-1")
    store.set(workflowLocalServerDataAtomFamily(SOURCE), {
        id: SOURCE,
        workflow_id: "wf-1",
        data: {parameters: {agent: {instructions: "server"}}},
    } as never)
})

describe("an edit made while the commit is in flight", () => {
    it("is not destroyed by the post-commit discard", async () => {
        // The user's first edit — this is what the commit will send.
        store.set(updateWorkflowDraftAtom, SOURCE, {
            data: {parameters: {agent: {instructions: "first"}}},
        } as never)

        // ...and while the request is open, they keep typing.
        commitApi.mockImplementation(async () => {
            store.set(updateWorkflowDraftAtom, SOURCE, {
                data: {parameters: {agent: {instructions: "first, then second"}}},
            } as never)
            return {id: NEW_REVISION, workflow_id: "wf-1", data: {parameters: {}}}
        })

        const result = await store.set(commitWorkflowRevisionAtom, {revisionId: SOURCE})
        expect(result.success).toBe(true)

        // The commit sent the FIRST edit — that is the snapshot semantics, and it is fine.
        const sent = commitApi.mock.calls[0]?.[1]?.data?.parameters
        expect(JSON.stringify(sent)).toContain("first")

        // The second edit must still exist: carried onto the new revision, or left on the old.
        const carried = JSON.stringify(draftParams(NEW_REVISION) ?? null)
        const kept = JSON.stringify(draftParams(SOURCE) ?? null)
        expect(`${carried}${kept}`).toContain("then second")
    })

    it("still discards the draft when nothing changed during the request", async () => {
        store.set(updateWorkflowDraftAtom, SOURCE, {
            data: {parameters: {agent: {instructions: "only edit"}}},
        } as never)

        commitApi.mockResolvedValue({
            id: NEW_REVISION,
            workflow_id: "wf-1",
            data: {parameters: {}},
        })

        const result = await store.set(commitWorkflowRevisionAtom, {revisionId: SOURCE})
        expect(result.success).toBe(true)
        // Committed and clean — a leftover draft here would show as a permanent phantom edit.
        expect(store.get(workflowDraftAtomFamily(SOURCE))).toBeNull()
    })
})
