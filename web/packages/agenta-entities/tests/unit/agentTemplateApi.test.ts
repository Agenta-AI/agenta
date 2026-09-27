import {beforeEach, describe, expect, it, vi} from "vitest"

const loadAgentTemplateMock = vi.fn()
const {axiosPostMock} = vi.hoisted(() => ({axiosPostMock: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getWorkflowsClient: () => ({loadAgentTemplate: loadAgentTemplateMock}),
}))

vi.mock("@agenta/shared/api", () => ({
    axios: {post: axiosPostMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {
    loadAgentTemplate,
    validateAgentTemplate,
    type AgentTemplateSource,
} from "../../src/workflow/api/agentTemplates"

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

    it.each<AgentTemplateSource>([
        {kind: "upload", staging_session_id: "staging-1", attachment_id: "attachment-1"},
        {kind: "session_file", session_id: "session-1", path: "templates/seo.zip"},
        {
            kind: "session_file",
            session_id: "session-1",
            path: "templates/seo.zip",
            pin: {version: "1.0.0", digest: "sha256:abc"},
        },
    ])("sends a $kind source unchanged", async (source) => {
        await loadAgentTemplate(
            {source, base_revision: {}, initial_message: "Set it up."},
            "template-request-2",
            "project-1",
        )

        expect(loadAgentTemplateMock.mock.calls[0][0].source).toEqual(source)
    })
})

describe("validateAgentTemplate", () => {
    const source: AgentTemplateSource = {
        kind: "session_file",
        session_id: "session-1",
        path: "templates/seo.zip",
    }

    beforeEach(() => {
        axiosPostMock.mockReset()
    })

    it("posts the source to the validate endpoint with the project id", async () => {
        axiosPostMock.mockResolvedValue({
            data: {
                valid: true,
                version: "1.0.0",
                digest: "sha256:abc",
                supported_schema_versions: ["1"],
                issues: [],
            },
        })

        const result = await validateAgentTemplate(source, "project-1")

        expect(axiosPostMock).toHaveBeenCalledWith(
            "https://agenta.test/api/agent-templates/validate",
            {source},
            {params: {project_id: "project-1"}},
        )
        expect(result).toEqual({
            valid: true,
            version: "1.0.0",
            digest: "sha256:abc",
            supported_schema_versions: ["1"],
            issues: [],
        })
    })

    it("returns the issues of an invalid package", async () => {
        const issue = {
            code: "missing_file",
            path: "SETUP.md",
            field: "setup",
            message: "The manifest points to SETUP.md, which is not in the package.",
            next_step: "Add SETUP.md or remove the setup field.",
        }
        axiosPostMock.mockResolvedValue({
            data: {
                valid: false,
                version: null,
                digest: null,
                supported_schema_versions: ["1"],
                issues: [issue],
            },
        })

        const result = await validateAgentTemplate(source, "project-1")

        expect(result?.valid).toBe(false)
        expect(result?.issues).toEqual([issue])
    })

    it("returns null for a response that does not match the contract", async () => {
        axiosPostMock.mockResolvedValue({data: {valid: "yes"}})
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        vi.spyOn(console, "warn").mockImplementation(() => undefined)

        expect(await validateAgentTemplate(source, "project-1")).toBeNull()
    })

    it("sends nothing without a project", async () => {
        expect(await validateAgentTemplate(source, "")).toBeNull()
        expect(axiosPostMock).not.toHaveBeenCalled()
    })
})
