import {beforeEach, describe, expect, it, vi} from "vitest"

const fernRetrieve = vi.fn()
const fetchSimpleApplication = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getWorkflowsClient: () => ({
        retrieveWorkflowRevision: fernRetrieve,
    }),
}))

vi.mock("@agenta/sdk", () => ({
    getAgentaSdkClient: () => ({
        applications: {
            fetchSimpleApplication,
        },
    }),
}))

import {AGENT_BUILD_KIT_WORKFLOW_SLUG, fetchAgentBuildKitOverlay} from "../../src/workflow/api/api"

const OVERLAY = {
    tools: [{op: "read_file", type: "platform"}],
    skills: [{"@ag.embed": {workflow: {slug: "__ag__build_an_agent"}}}],
    sandbox: {permissions: {write_files: "allow"}},
}

beforeEach(() => {
    fernRetrieve.mockReset()
    fetchSimpleApplication.mockReset()
})

describe("fetchAgentBuildKitOverlay", () => {
    it("retrieves the reserved build-kit workflow by slug and returns parameters.agent", async () => {
        fernRetrieve.mockResolvedValueOnce({
            workflow_revision: {
                id: "kit-rev-1",
                data: {parameters: {agent: OVERLAY}},
            },
        })

        const result = await fetchAgentBuildKitOverlay("proj-42")

        expect(fernRetrieve).toHaveBeenCalledTimes(1)
        const [body, opts] = fernRetrieve.mock.calls[0]
        expect(body).toEqual({workflow_ref: {slug: AGENT_BUILD_KIT_WORKFLOW_SLUG}})
        expect(opts).toEqual({queryParams: {project_id: "proj-42"}})
        expect(result).toEqual(OVERLAY)
    })

    it("short-circuits without a project id", async () => {
        const result = await fetchAgentBuildKitOverlay("")

        expect(result).toBeNull()
        expect(fernRetrieve).not.toHaveBeenCalled()
    })

    it("returns null when the revision carries no agent overlay", async () => {
        fernRetrieve.mockResolvedValueOnce({
            workflow_revision: {
                id: "kit-rev-1",
                data: {parameters: {}},
            },
        })

        const result = await fetchAgentBuildKitOverlay("proj-1")

        expect(result).toBeNull()
    })

    it("rejects a non-object overlay at the boundary", async () => {
        fernRetrieve.mockResolvedValueOnce({
            workflow_revision: {
                id: "kit-rev-1",
                data: {parameters: {agent: "nope"}},
            },
        })

        const result = await fetchAgentBuildKitOverlay("proj-1")

        expect(result).toBeNull()
    })
})
