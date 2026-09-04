import type {SessionCapabilities, SessionStreamResponse} from "@agentaai/api-client"
import {beforeEach, describe, expect, expectTypeOf, it, vi} from "vitest"

const {resume, fetchStream} = vi.hoisted(() => ({resume: vi.fn(), fetchStream: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({
        resumeSessionContinuation: resume,
        fetchSessionStream: fetchStream,
    }),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {
    fetchSessionDurableApprovalsCapability,
    resumeSessionContinuation,
} from "../../src/session/api/api"

beforeEach(() => {
    resume.mockReset()
    fetchStream.mockReset()
})

describe("resumeSessionContinuation", () => {
    it.each([true, false])("returns resumed=%s from the scoped preflight", async (resumed) => {
        resume.mockResolvedValue({resumed})

        await expect(
            resumeSessionContinuation({
                projectId: "project-1",
                sessionId: "session/1",
            }),
        ).resolves.toBe(resumed)

        expect(resume).toHaveBeenCalledWith(
            {session_id: "session/1"},
            expect.objectContaining({queryParams: {project_id: "project-1"}}),
        )
    })

    it("fails open when the API response cannot establish ownership", async () => {
        resume.mockResolvedValue({resumed: "maybe"})

        await expect(
            resumeSessionContinuation({projectId: "project-1", sessionId: "session-1"}),
        ).resolves.toBe(false)
    })

    it("fails open on a continuation transport failure", async () => {
        resume.mockRejectedValue(new Error("route missing"))

        await expect(
            resumeSessionContinuation({projectId: "project-1", sessionId: "session-1"}),
        ).resolves.toBe(false)
    })
})

describe("fetchSessionDurableApprovalsCapability", () => {
    it("uses the generated named capability model", () => {
        expectTypeOf<
            NonNullable<SessionStreamResponse["capabilities"]>
        >().toEqualTypeOf<SessionCapabilities>()
    })

    it("uses the authenticated session response as the capability source", async () => {
        fetchStream.mockResolvedValue({
            stream: null,
            capabilities: {durable_approvals: true},
        })

        await expect(
            fetchSessionDurableApprovalsCapability({
                projectId: "project-1",
                sessionId: "session-1",
            }),
        ).resolves.toBe(true)
    })

    it.each([
        ["older API", {stream: null}],
        ["failed request", null],
    ])("uses legacy behavior for %s", async (_case, response) => {
        fetchStream.mockResolvedValue(response)

        await expect(
            fetchSessionDurableApprovalsCapability({
                projectId: "project-1",
                sessionId: "session-1",
            }),
        ).resolves.toBe(false)
    })
})
