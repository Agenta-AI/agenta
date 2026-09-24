import {beforeEach, describe, expect, it, vi} from "vitest"

const {resume, sendNow, updateInput} = vi.hoisted(() => ({
    resume: vi.fn(),
    sendNow: vi.fn(),
    updateInput: vi.fn(),
}))

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({
        resumeSessionContinuation: resume,
        sendPendingSessionInputNow: sendNow,
        updatePendingSessionInput: updateInput,
    }),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {
    updatePendingSessionInput,
    sendPendingSessionInputNow,
    resumeSessionContinuation,
} from "../../src/session/api/api"

beforeEach(() => {
    resume.mockReset()
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

it.each([
    [{action: "execute", execution_id: "execution"}, true],
    [{action: "pending"}, true],
    [{action: "unknown"}, false],
    [{}, false],
    [{action: "pending", input: {id: "incomplete"}}, false],
    [null, false],
])("validates Send Now admission %j", async (response, accepted) => {
    sendNow.mockResolvedValue(response)
    await expect(
        sendPendingSessionInputNow({projectId: "project", sessionId: "session", inputId: "input"}),
    ).resolves.toBe(accepted)
})

it.each([
    [
        {
            input: {
                id: "input",
                session_id: "session",
                content: {data: {inputs: {messages: []}}},
                position: 1,
                state: "pending",
                policy: "queue",
            },
        },
        true,
    ],
    [{}, false],
    [{input: null}, false],
    [{input: {id: "input"}}, false],
    [{action: "pending"}, false],
    [null, false],
])("validates a queued edit receipt %j", async (response, accepted) => {
    updateInput.mockResolvedValue(response)
    await expect(
        updatePendingSessionInput({
            projectId: "project",
            sessionId: "session",
            inputId: "input",
            text: "edited",
        }),
    ).resolves.toBe(accepted)
})
