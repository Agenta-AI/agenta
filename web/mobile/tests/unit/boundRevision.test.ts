import {beforeEach, describe, expect, it, vi} from "vitest"

const retrieveWorkflowRevision = vi.fn()
vi.mock("@agenta/entities/workflow", () => ({
    retrieveWorkflowRevision: (...args: unknown[]) => retrieveWorkflowRevision(...args),
}))
vi.mock("@agenta/entities/session", () => ({querySessions: vi.fn()}))

const {retrieveBoundRevision} = await import("@/features/chat/useAgentEntity")

const revision = {id: "rev-1", workflow_id: "wf-1"}

describe("retrieveBoundRevision", () => {
    beforeEach(() => retrieveWorkflowRevision.mockReset())

    it("resolves a workflow id with one request", async () => {
        retrieveWorkflowRevision.mockResolvedValueOnce(revision)
        await expect(retrieveBoundRevision("p", "wf-1")).resolves.toEqual({
            revisionId: "rev-1",
            workflowId: "wf-1",
        })
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(1)
        expect(retrieveWorkflowRevision).toHaveBeenCalledWith({
            projectId: "p",
            workflowRef: {id: "wf-1"},
        })
    })

    it("falls back to the variant, then the revision, on a miss", async () => {
        retrieveWorkflowRevision
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(revision)
        await expect(retrieveBoundRevision("p", "rev-1")).resolves.toEqual({
            revisionId: "rev-1",
            workflowId: "wf-1",
        })
        expect(retrieveWorkflowRevision.mock.calls.map(([args]) => args)).toEqual([
            {projectId: "p", workflowRef: {id: "rev-1"}},
            {projectId: "p", workflowVariantRef: {id: "rev-1"}},
            {projectId: "p", workflowRevisionRef: {id: "rev-1"}},
        ])
    })

    it("is null when no level names the id", async () => {
        retrieveWorkflowRevision.mockResolvedValue(null)
        await expect(retrieveBoundRevision("p", "nope")).resolves.toBeNull()
        expect(retrieveWorkflowRevision).toHaveBeenCalledTimes(3)
    })
})
