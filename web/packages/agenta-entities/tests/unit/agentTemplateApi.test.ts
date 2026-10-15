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
    agentTemplateLoadRecovery,
    loadAgentTemplate,
    parseAgentTemplateError,
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

describe("parseAgentTemplateError", () => {
    it("reads the template envelope from a Fern error", () => {
        const error = parseAgentTemplateError({
            statusCode: 503,
            body: {
                code: "template_load_incomplete",
                message: "The template workspace could not be stored.",
                retryable: true,
                details: {},
                next_step: "Retry with the same Idempotency-Key; do not submit a new request.",
            },
        })
        expect(error).toEqual({
            status: 503,
            code: "template_load_incomplete",
            message: "The template workspace could not be stored.",
            nextStep: "Retry with the same Idempotency-Key; do not submit a new request.",
            retryable: true,
            reason: null,
            field: null,
        })
        expect(agentTemplateLoadRecovery(error)).toBe("retry")
    })

    it("reads the reason of a stale session file from an axios error", () => {
        const error = parseAgentTemplateError({
            response: {
                status: 422,
                data: {
                    code: "template_package_invalid",
                    message: "The template source changed.",
                    retryable: false,
                    details: {reason: "template_source_digest_mismatch"},
                },
            },
        })
        expect(error.reason).toBe("template_source_digest_mismatch")
        expect(agentTemplateLoadRecovery(error)).toBe("check_again")
    })

    it("names the field of a FastAPI request validation failure", () => {
        const error = parseAgentTemplateError({
            statusCode: 422,
            body: {
                detail: [
                    {
                        loc: ["body", "source", "github", "commit"],
                        msg: "Value error, commit 'main' is not a commit SHA.",
                        type: "value_error",
                    },
                ],
            },
        })
        expect(error).toMatchObject({
            code: "invalid_request",
            field: "commit",
            message: "commit 'main' is not a commit SHA.",
        })
        expect(agentTemplateLoadRecovery(error)).toBe("edit_source")
    })

    it("treats a lost response as unknown and retryable", () => {
        const error = parseAgentTemplateError(new TypeError("Failed to fetch"))
        expect(error.status).toBeNull()
        expect(agentTemplateLoadRecovery(error)).toBe("retry")
    })

    it("asks for a new key when the old one belongs to another request", () => {
        const error = parseAgentTemplateError({
            statusCode: 409,
            body: {code: "template_load_conflict", message: "Conflict.", retryable: false},
        })
        expect(agentTemplateLoadRecovery(error)).toBe("start_over")
    })

    it("sends a missing source back to the source fields", () => {
        const error = parseAgentTemplateError({
            statusCode: 404,
            body: {code: "template_source_unavailable", message: "Not found.", retryable: false},
        })
        expect(agentTemplateLoadRecovery(error)).toBe("edit_source")
    })
})
