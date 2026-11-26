import {beforeEach, describe, expect, it, vi} from "vitest"

const {retrieveWorkflowRevision, commitWorkflowRevision} = vi.hoisted(() => ({
    retrieveWorkflowRevision: vi.fn(),
    commitWorkflowRevision: vi.fn(),
}))

vi.mock("@agenta/entities/workflow", () => ({retrieveWorkflowRevision}))
vi.mock("@agenta/entities/shared", () => ({safeParseWithLogging: vi.fn()}))
vi.mock("@agenta/sdk/resources", () => ({
    getSkillsClient: vi.fn(),
    getWorkflowsClient: () => ({commitWorkflowRevision}),
}))

import {removeSkillFromAgents} from "../../src/api"
import {buildSkillEmbedEntry} from "../../src/embed"

const entry = (slug: string, workflowId?: string) =>
    buildSkillEmbedEntry({slug, workflowId, name: slug, mode: "latest"})

const headWith = (skills: unknown[]) => ({
    id: "rev-1",
    workflow_variant_id: "var-1",
    data: {parameters: {agent: {skills}}},
})

const committedSkills = () =>
    commitWorkflowRevision.mock.calls[0][0].workflow_revision.data.parameters.agent.skills

describe("removeSkillFromAgents", () => {
    beforeEach(() => {
        retrieveWorkflowRevision.mockReset()
        commitWorkflowRevision.mockReset()
    })

    it("removes an entry the agent picker wrote with the workflow slug", async () => {
        const other = entry("other-skill-9z9z", "wf-2")
        retrieveWorkflowRevision.mockResolvedValue(
            headWith([entry("laptop-policy-3f2a", "wf-1"), other]),
        )

        const outcome = await removeSkillFromAgents({
            projectId: "p",
            agentWorkflowIds: ["agent-1"],
            slug: "laptop-policy-3f2a",
            skillWorkflowId: "wf-1",
        })

        expect(outcome.removed).toEqual(["agent-1"])
        expect(committedSkills()).toEqual([other])
    })

    it("removes an entry stored with the skill name by its workflow id", async () => {
        retrieveWorkflowRevision.mockResolvedValue(headWith([entry("laptop-policy", "wf-1")]))

        await removeSkillFromAgents({
            projectId: "p",
            agentWorkflowIds: ["agent-1"],
            slug: "laptop-policy-3f2a",
            skillWorkflowId: "wf-1",
        })

        expect(committedSkills()).toEqual([])
    })

    it("keeps entries that reference another workflow", async () => {
        retrieveWorkflowRevision.mockResolvedValue(headWith([entry("laptop-policy", "wf-2")]))

        await removeSkillFromAgents({
            projectId: "p",
            agentWorkflowIds: ["agent-1"],
            slug: "laptop-policy-3f2a",
            skillWorkflowId: "wf-1",
        })

        expect(commitWorkflowRevision).not.toHaveBeenCalled()
    })
})
