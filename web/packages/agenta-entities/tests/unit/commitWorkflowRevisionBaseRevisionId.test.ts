/**
 * Unit tests for the playground save-guard's wire contract (Option A):
 *
 *  - `commitWorkflowRevisionApi` sends the caller's `baseRevisionId` as
 *    `workflow_revision.base_revision_id` so the backend can refuse a commit built on a
 *    stale head (409 `revision_conflict`) instead of silently overwriting a newer commit.
 *  - `parseWorkflowRevisionConflict` recognizes that 409 defensively — the canonical
 *    `{detail: {code, details}}` envelope today, plus flattened shapes an in-flight API
 *    error-envelope migration may produce.
 *
 * Tests stub `@agenta/shared/api` (axios) so no network call is made.
 */
import {beforeEach, describe, expect, it, vi} from "vitest"

const {post} = vi.hoisted(() => ({post: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {post},
    getAgentaApiUrl: () => "https://api.test",
}))

import {commitWorkflowRevisionApi} from "../../src/workflow/api/api"
import {parseWorkflowRevisionConflict} from "../../src/workflow/api/revisionConflict"

beforeEach(() => {
    post.mockReset()
})

describe("commitWorkflowRevisionApi — base_revision_id", () => {
    it("sends the caller's baseRevisionId as workflow_revision.base_revision_id", async () => {
        post.mockResolvedValueOnce({data: {workflow_revision: {id: "rev-2"}}})

        await commitWorkflowRevisionApi("proj-1", {
            workflowId: "wf-1",
            variantId: "var-1",
            data: {uri: "agenta:builtin:agent:v0"},
            baseRevisionId: "rev-1",
        })

        const [, body] = post.mock.calls[0]
        expect(body.workflow_revision.base_revision_id).toBe("rev-1")
    })

    it("omits base_revision_id when the caller doesn't supply one (last-write-wins)", async () => {
        post.mockResolvedValueOnce({data: {workflow_revision: {id: "rev-2"}}})

        await commitWorkflowRevisionApi("proj-1", {
            workflowId: "wf-1",
            variantId: "var-1",
            data: {uri: "agenta:builtin:agent:v0"},
        })

        const [, body] = post.mock.calls[0]
        expect(body.workflow_revision.base_revision_id).toBeUndefined()
    })
})

describe("parseWorkflowRevisionConflict", () => {
    it("parses the canonical {detail: {code, details}} envelope", () => {
        const error = {
            response: {
                status: 409,
                data: {
                    detail: {
                        code: "revision_conflict",
                        message: "The workflow head changed. No revision was committed.",
                        retryable: false,
                        details: {
                            base_revision_id: "rev-1",
                            current_revision_id: "rev-2",
                            current_revision_version: "3",
                        },
                    },
                },
            },
        }

        expect(parseWorkflowRevisionConflict(error)).toEqual({
            baseRevisionId: "rev-1",
            currentRevisionId: "rev-2",
            currentRevisionVersion: "3",
        })
    })

    it("parses a flattened envelope with code/details at the top level", () => {
        const error = {
            response: {
                status: 409,
                data: {
                    code: "revision_conflict",
                    details: {base_revision_id: "rev-1", current_revision_id: "rev-2"},
                },
            },
        }

        expect(parseWorkflowRevisionConflict(error)).toEqual({
            baseRevisionId: "rev-1",
            currentRevisionId: "rev-2",
            currentRevisionVersion: undefined,
        })
    })

    it("parses a flattened envelope where detail is the code string itself", () => {
        const error = {
            response: {
                status: 409,
                data: {
                    detail: "revision_conflict",
                    details: {current_revision_id: "rev-2"},
                },
            },
        }

        expect(parseWorkflowRevisionConflict(error)?.currentRevisionId).toBe("rev-2")
    })

    it("returns null for a 409 from an unrelated cause (e.g. a slug collision)", () => {
        const error = {
            response: {
                status: 409,
                data: {detail: {code: "slug_conflict", message: "Slug already in use."}},
            },
        }

        expect(parseWorkflowRevisionConflict(error)).toBeNull()
    })

    it("returns null for a non-409 error", () => {
        const error = {
            response: {
                status: 422,
                data: {detail: {code: "revision_conflict"}},
            },
        }

        expect(parseWorkflowRevisionConflict(error)).toBeNull()
    })

    it("returns null for a plain Error with no response", () => {
        expect(parseWorkflowRevisionConflict(new Error("network down"))).toBeNull()
    })
})
