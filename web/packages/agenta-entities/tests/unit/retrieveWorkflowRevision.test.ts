/**
 * Unit tests for `retrieveWorkflowRevision`.
 *
 * The function shapes a `POST /workflows/revisions/retrieve` request from
 * mixed-id/slug/version refs, gates out requests that the backend would
 * reject (no identifying ref), and validates the response against the
 * workflow zod schema. Tests stub the Fern client so the test never hits
 * the network and we can introspect the call.
 */

import {beforeEach, describe, expect, it, vi} from "vitest"

const fernRetrieve = vi.fn()

// Mock `@agenta/sdk` so we can replace the Fern client method without
// constructing a real client (which would try to read env vars and
// initialize transport). `getAgentaSdkClient` returns the same fake
// every call, so per-test state lives on `fernRetrieve`.
vi.mock("@agenta/sdk", () => ({
    getAgentaSdkClient: () => ({
        workflows: {
            retrieveWorkflowRevision: fernRetrieve,
        },
    }),
}))

import {retrieveWorkflowRevision} from "../../src/workflow/api/api"

beforeEach(() => {
    fernRetrieve.mockReset()
})

describe("retrieveWorkflowRevision — early returns", () => {
    it("returns null when projectId is empty", async () => {
        const result = await retrieveWorkflowRevision({projectId: ""})
        expect(result).toBeNull()
        expect(fernRetrieve).not.toHaveBeenCalled()
    })

    it("returns null when no identifying ref is supplied", async () => {
        // No ref at any level — the backend would 400, but more importantly
        // the request is meaningless.
        const result = await retrieveWorkflowRevision({projectId: "proj-1"})
        expect(result).toBeNull()
        expect(fernRetrieve).not.toHaveBeenCalled()
    })

    it("returns null when refs carry only a version (no id/slug at any level)", async () => {
        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRevisionRef: {version: "1"},
        })
        expect(result).toBeNull()
        expect(fernRetrieve).not.toHaveBeenCalled()
    })

    it("returns null when refs are present but all id/slug fields are absent", async () => {
        // workflowRevisionRef carries only `version` — not enough.
        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {version: "v1"},
            workflowRevisionRef: {version: "1"},
        })
        expect(result).toBeNull()
        expect(fernRetrieve).not.toHaveBeenCalled()
    })
})

describe("retrieveWorkflowRevision — request shaping", () => {
    const validRevision = {
        id: "rev-1",
        workflow_id: "wf-1",
        artifact_slug: "my-app",
    }
    const validResponse = {workflow_revision: validRevision}

    it("invokes the Fern client with project_id as a queryParam", async () => {
        fernRetrieve.mockResolvedValueOnce(validResponse)

        await retrieveWorkflowRevision({
            projectId: "proj-42",
            workflowRef: {id: "wf-1"},
        })

        expect(fernRetrieve).toHaveBeenCalledTimes(1)
        const [body, opts] = fernRetrieve.mock.calls[0]
        expect(body).toEqual({workflow_ref: {id: "wf-1"}})
        expect(opts).toEqual({queryParams: {project_id: "proj-42"}})
    })

    it("includes every supplied ref in the body, snake-cased", async () => {
        fernRetrieve.mockResolvedValueOnce(validResponse)

        await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {slug: "my-app"},
            workflowVariantRef: {slug: "v1"},
            workflowRevisionRef: {id: "rev-1"},
        })

        const [body] = fernRetrieve.mock.calls[0]
        expect(body).toEqual({
            workflow_ref: {slug: "my-app"},
            workflow_variant_ref: {slug: "v1"},
            workflow_revision_ref: {id: "rev-1"},
        })
    })

    it("omits unset ref fields from the body", async () => {
        fernRetrieve.mockResolvedValueOnce(validResponse)

        await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowVariantRef: {slug: "v1"},
        })

        const [body] = fernRetrieve.mock.calls[0]
        expect(body).toEqual({workflow_variant_ref: {slug: "v1"}})
        expect(body).not.toHaveProperty("workflow_ref")
        expect(body).not.toHaveProperty("workflow_revision_ref")
    })
})

describe("retrieveWorkflowRevision — response handling", () => {
    it("returns the revision object when validation passes", async () => {
        const revision = {id: "rev-1", workflow_id: "wf-1", artifact_slug: "my-app"}
        fernRetrieve.mockResolvedValueOnce({workflow_revision: revision})

        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {id: "wf-1"},
        })

        expect(result).toMatchObject(revision)
    })

    it("returns null when the response envelope has no workflow_revision", async () => {
        fernRetrieve.mockResolvedValueOnce({})

        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {id: "wf-1"},
        })

        expect(result).toBeNull()
    })

    it("returns null when validation fails (unparseable shape)", async () => {
        // zod's safeParse rejects this — workflow_revision is expected to
        // be an object, not a string. safeParseWithLogging swallows the
        // failure and returns undefined; the caller maps to null.
        fernRetrieve.mockResolvedValueOnce({workflow_revision: "not an object"})

        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {id: "wf-1"},
        })

        expect(result).toBeNull()
    })
})
