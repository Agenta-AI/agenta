import {QueryClient} from "@tanstack/react-query"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({retrieveWorkflowRevision: vi.fn()}))
vi.mock("@agenta/entities/session", () => ({querySessions: vi.fn()}))

const {agentLatestRevisionQueryKey, boundReferenceId} =
    await import("@/features/chat/useAgentEntity")

const WF = "0198d3c1-0000-7000-8000-000000000001"
const VAR = "0198d3c1-0000-7000-8000-000000000002"
const REV = "0198d3c1-0000-7000-8000-000000000003"

describe("agentLatestRevisionQueryKey", () => {
    // The commit paths — auto-save, the agent committing itself, a `workflow-changed` watch
    // event — clear `["workflows", "latestRevision"]` by prefix. A key of this app's own was
    // reached by none of them, so an unpinned session kept resolving a stale snapshot.
    it("is reached by the shared latest-revision invalidation", () => {
        const client = new QueryClient()
        const key = agentLatestRevisionQueryKey("p1", WF)
        client.setQueryData(key, {revisionId: REV, workflowId: WF})

        void client.invalidateQueries({queryKey: ["workflows", "latestRevision"], exact: false})

        expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    })

    it("is keyed per project and bound id", () => {
        expect(agentLatestRevisionQueryKey("p1", WF)).not.toEqual(
            agentLatestRevisionQueryKey("p1", VAR),
        )
        expect(agentLatestRevisionQueryKey("p1", WF)).not.toEqual(
            agentLatestRevisionQueryKey("p2", WF),
        )
    })
})

describe("boundReferenceId", () => {
    it("binds by the workflow ref, whatever the order the row lists its refs in", () => {
        expect(
            boundReferenceId([
                {key: "workflow_revision", id: REV},
                {key: "workflow_variant", id: VAR},
                {key: "workflow", id: WF},
            ]),
        ).toBe(WF)
    })

    // A trigger written through the SDK may bind a variant or a revision only.
    it("falls back to the first id-bearing ref when there is no workflow ref", () => {
        expect(boundReferenceId([{key: "workflow_variant", id: VAR}])).toBe(VAR)
        expect(boundReferenceId([{key: "workflow_revision", id: REV}])).toBe(REV)
    })

    it("is null for a session with no refs, or refs that are not ids", () => {
        expect(boundReferenceId(undefined)).toBeNull()
        expect(boundReferenceId([])).toBeNull()
        expect(boundReferenceId([{key: "workflow", id: "not-a-uuid"}])).toBeNull()
    })
})
