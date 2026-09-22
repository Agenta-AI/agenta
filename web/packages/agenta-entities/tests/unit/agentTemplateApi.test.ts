import {beforeEach, describe, expect, it, vi} from "vitest"

const loadAgentTemplateMock = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getWorkflowsClient: () => ({loadAgentTemplate: loadAgentTemplateMock}),
}))

import {loadAgentTemplate} from "../../src/workflow/api/agentTemplates"

describe("loadAgentTemplate", () => {
    beforeEach(() => {
        loadAgentTemplateMock.mockReset()
        loadAgentTemplateMock.mockResolvedValue({workflow_id: "workflow-1"})
    })

    it("uses the generated client and carries the idempotency header", async () => {
        const request = {
            source: {kind: "internal" as const, key: "pr-reviewer"},
            base_revision: {uri: "agenta:builtin:agent:v0"},
            initial_message: "Review the pull request.",
            connection_choices: [],
        }

        await loadAgentTemplate(request, "template-request-1", "project-1")

        expect(loadAgentTemplateMock).toHaveBeenCalledWith(
            {...request, project_id: "project-1"},
            {headers: {"Idempotency-Key": "template-request-1"}},
        )
    })
})
