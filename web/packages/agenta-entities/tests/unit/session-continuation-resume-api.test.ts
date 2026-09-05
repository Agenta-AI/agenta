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
    fetchSessionCapabilities,
    fetchSessionDurableApprovalsCapability,
    invalidateSessionDurableApprovalsCapability,
    resumeSessionContinuation,
} from "../../src/session/api/api"

beforeEach(() => {
    resume.mockReset()
    fetchStream.mockReset()
    invalidateSessionDurableApprovalsCapability()
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

        const scope = {projectId: "project-1", sessionId: "session-1"}

        await expect(fetchSessionDurableApprovalsCapability(scope)).resolves.toBe(false)
        await vi.waitFor(() =>
            expect(fetchSessionDurableApprovalsCapability(scope)).resolves.toBe(true),
        )
        expect(fetchStream).toHaveBeenCalledWith(
            {session_id: "session-1"},
            expect.objectContaining({timeoutInSeconds: 2, maxRetries: 0}),
        )
    })

    it("returns queue capabilities from the same cached negotiation", async () => {
        fetchStream.mockResolvedValue({
            stream: null,
            capabilities: {durable_approvals: false, queue: true, steer: true},
        })
        const scope = {projectId: "project-1", sessionId: "session-1"}

        await expect(fetchSessionCapabilities(scope)).resolves.toEqual({
            durableApprovals: false,
            queue: true,
            steer: true,
        })
        await expect(fetchSessionCapabilities(scope)).resolves.toEqual({
            durableApprovals: false,
            queue: true,
            steer: true,
        })
        expect(fetchStream).toHaveBeenCalledOnce()
    })

    it("shares one request per session until the session reconnects", async () => {
        fetchStream.mockResolvedValue({
            stream: null,
            capabilities: {durable_approvals: true},
        })
        const scope = {projectId: "project-1", sessionId: "session-1"}

        await Promise.all([
            fetchSessionDurableApprovalsCapability(scope),
            fetchSessionDurableApprovalsCapability(scope),
        ])
        await vi.waitFor(() => expect(fetchStream).toHaveBeenCalledTimes(1))
        await fetchSessionDurableApprovalsCapability(scope)

        expect(fetchStream).toHaveBeenCalledTimes(1)

        invalidateSessionDurableApprovalsCapability(scope)
        await fetchSessionDurableApprovalsCapability(scope)

        expect(fetchStream).toHaveBeenCalledTimes(2)
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

    it("does not delay a legacy send while capability negotiation is slow", async () => {
        fetchStream.mockImplementation(() => new Promise(() => undefined))
        const prepare = vi.fn().mockResolvedValue("legacy send")

        const capability = await fetchSessionDurableApprovalsCapability({
            projectId: "project-1",
            sessionId: "session-1",
        })
        const result = capability ? "durable path" : await prepare()

        expect(result).toBe("legacy send")
        expect(prepare).toHaveBeenCalledOnce()
        expect(fetchStream).toHaveBeenCalledOnce()
    })

    it("caches a failed negotiation instead of retrying it on every send", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
        fetchStream.mockRejectedValue(new Error("route unavailable"))
        const scope = {projectId: "project-1", sessionId: "session-1"}

        await fetchSessionDurableApprovalsCapability(scope)
        await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
        await fetchSessionDurableApprovalsCapability(scope)
        await fetchSessionDurableApprovalsCapability(scope)

        expect(fetchStream).toHaveBeenCalledOnce()
        error.mockRestore()
    })
})
