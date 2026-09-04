import {beforeEach, describe, expect, it, vi} from "vitest"

const {resume} = vi.hoisted(() => ({resume: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({resumeSessionContinuation: resume}),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {resumeSessionContinuation} from "../../src/session/api/api"

beforeEach(() => resume.mockReset())

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

    it("fails closed when the API response cannot establish ownership", async () => {
        resume.mockResolvedValue({resumed: "maybe"})

        await expect(
            resumeSessionContinuation({projectId: "project-1", sessionId: "session-1"}),
        ).rejects.toThrow("invalid response")
    })
})
