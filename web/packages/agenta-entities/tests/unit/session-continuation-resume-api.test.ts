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

        await expect(fetchSessionDurableApprovalsCapability(scope)).resolves.toBe(true)
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

    it.each([["older API", {stream: null}]])(
        "uses legacy behavior for %s",
        async (_case, response) => {
            fetchStream.mockResolvedValue(response)

            await expect(
                fetchSessionDurableApprovalsCapability({
                    projectId: "project-1",
                    sessionId: "session-1",
                }),
            ).resolves.toBe(false)
        },
    )

    it("retries unknown capability without caching it as unsupported", async () => {
        fetchStream
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({stream: null, capabilities: {durable_approvals: true}})
        const scope = {projectId: "project-1", sessionId: "session-1"}
        await expect(fetchSessionDurableApprovalsCapability(scope)).rejects.toThrow(
            "capabilities are unavailable",
        )
        await expect(fetchSessionDurableApprovalsCapability(scope)).resolves.toBe(true)
        expect(fetchStream).toHaveBeenCalledTimes(2)
    })
})

it("keeps an initial approval answer waiting for capability discovery", async () => {
    let resolve!: (value: unknown) => void
    fetchStream.mockImplementation(
        () =>
            new Promise((done) => {
                resolve = done
            }),
    )
    let settled = false
    const result = fetchSessionDurableApprovalsCapability({
        projectId: "project-1",
        sessionId: "session-1",
    }).then((value) => {
        settled = true
        return value
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    resolve({stream: null, capabilities: {durable_approvals: true}})
    await expect(result).resolves.toBe(true)
})
it("keeps missing project scope unknown", async () => {
    await expect(
        fetchSessionCapabilities({projectId: "", sessionId: "session-1"}),
    ).resolves.toBeNull()
    expect(fetchStream).not.toHaveBeenCalled()
})
