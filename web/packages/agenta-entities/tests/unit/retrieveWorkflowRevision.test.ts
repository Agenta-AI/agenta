/**
 * Unit tests for `retrieveWorkflowRevision`.
 *
 * The function shapes a `POST /workflows/revisions/retrieve` request from
 * mixed-id/slug/version refs, gates out requests that the backend would
 * reject (no identifying ref), and validates the response against the
 * workflow zod schema. Tests stub the axios module and assert the wire-
 * level shape — what URL, what body, what params — plus the early-return
 * paths that should NEVER reach axios.
 */

import {beforeEach, describe, expect, it, vi} from "vitest"

// Mock axios + getAgentaApiUrl from @agenta/shared/api so the test never hits
// the network and we can introspect the call.
vi.mock("@agenta/shared/api", async () => {
    const actual = await vi.importActual<typeof import("@agenta/shared/api")>("@agenta/shared/api")
    return {
        ...actual,
        axios: {
            post: vi.fn(),
            get: vi.fn(),
        },
        getAgentaApiUrl: () => "https://api.test.local",
    }
})

import {axios} from "@agenta/shared/api"

import {retrieveWorkflowRevision} from "../../src/workflow/api/api"

const mockedPost = vi.mocked(axios.post)

beforeEach(() => {
    mockedPost.mockReset()
})

describe("retrieveWorkflowRevision — early returns", () => {
    it("returns null when projectId is empty", async () => {
        const result = await retrieveWorkflowRevision({projectId: ""})
        expect(result).toBeNull()
        expect(mockedPost).not.toHaveBeenCalled()
    })

    it("returns null when no identifying ref is supplied", async () => {
        // No ref at any level — the backend would 400, but more importantly
        // the request is meaningless.
        const result = await retrieveWorkflowRevision({projectId: "proj-1"})
        expect(result).toBeNull()
        expect(mockedPost).not.toHaveBeenCalled()
    })

    it("returns null when refs carry only a version (no id/slug at any level)", async () => {
        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRevisionRef: {version: "1"},
        })
        expect(result).toBeNull()
        expect(mockedPost).not.toHaveBeenCalled()
    })

    it("returns null when refs are present but all id/slug fields are absent", async () => {
        // workflowRevisionRef carries only `version` — not enough.
        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {version: "v1"},
            workflowRevisionRef: {version: "1"},
        })
        expect(result).toBeNull()
        expect(mockedPost).not.toHaveBeenCalled()
    })
})

describe("retrieveWorkflowRevision — request shaping", () => {
    const validRevision = {
        id: "rev-1",
        workflow_id: "wf-1",
        artifact_slug: "my-app",
    }
    const validResponse = {workflow_revision: validRevision}

    it("posts to /workflows/revisions/retrieve with project_id query param", async () => {
        mockedPost.mockResolvedValueOnce({data: validResponse})

        await retrieveWorkflowRevision({
            projectId: "proj-42",
            workflowRef: {id: "wf-1"},
        })

        expect(mockedPost).toHaveBeenCalledTimes(1)
        const [url, body, opts] = mockedPost.mock.calls[0]
        expect(url).toBe("https://api.test.local/workflows/revisions/retrieve")
        expect(body).toEqual({workflow_ref: {id: "wf-1"}})
        expect(opts).toEqual({params: {project_id: "proj-42"}})
    })

    it("includes every supplied ref in the body, snake-cased", async () => {
        mockedPost.mockResolvedValueOnce({data: validResponse})

        await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {slug: "my-app"},
            workflowVariantRef: {slug: "v1"},
            workflowRevisionRef: {id: "rev-1"},
        })

        const [, body] = mockedPost.mock.calls[0]
        expect(body).toEqual({
            workflow_ref: {slug: "my-app"},
            workflow_variant_ref: {slug: "v1"},
            workflow_revision_ref: {id: "rev-1"},
        })
    })

    it("omits unset ref fields from the body", async () => {
        mockedPost.mockResolvedValueOnce({data: validResponse})

        await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowVariantRef: {slug: "v1"},
        })

        const [, body] = mockedPost.mock.calls[0]
        expect(body).toEqual({workflow_variant_ref: {slug: "v1"}})
        expect(body).not.toHaveProperty("workflow_ref")
        expect(body).not.toHaveProperty("workflow_revision_ref")
    })
})

describe("retrieveWorkflowRevision — response handling", () => {
    it("returns the revision object when validation passes", async () => {
        const revision = {id: "rev-1", workflow_id: "wf-1", artifact_slug: "my-app"}
        mockedPost.mockResolvedValueOnce({data: {workflow_revision: revision}})

        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {id: "wf-1"},
        })

        expect(result).toMatchObject(revision)
    })

    it("returns null when the response envelope has no workflow_revision", async () => {
        mockedPost.mockResolvedValueOnce({data: {}})

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
        mockedPost.mockResolvedValueOnce({data: {workflow_revision: "not an object"}})

        const result = await retrieveWorkflowRevision({
            projectId: "proj-1",
            workflowRef: {id: "wf-1"},
        })

        expect(result).toBeNull()
    })
})
