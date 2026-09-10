import {beforeEach, describe, expect, it, vi} from "vitest"

const fernCancelSessionExecution = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({cancelSessionExecution: fernCancelSessionExecution}),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {cancelSessionExecution} from "../../src/session/api/api"

const response = {
    command: {id: "command-1", state: "pending"},
    execution: {id: "turn-1", state: "stopping"},
}

beforeEach(() => {
    fernCancelSessionExecution.mockReset()
    fernCancelSessionExecution.mockReturnValue({
        withRawResponse: () => Promise.resolve({data: response, rawResponse: {status: 202}}),
    })
})

describe("cancelSessionExecution", () => {
    it("uses the Fern route with project query scope and the observed turn", async () => {
        const result = await cancelSessionExecution({
            projectId: "project-1",
            appId: "app-1",
            sessionId: "session-1",
            expectedExecutionId: "turn-1",
            idempotencyKey: "stop-1",
        })

        expect(fernCancelSessionExecution).toHaveBeenCalledWith(
            {
                session_id: "session-1",
                body: {expected_execution_id: "turn-1"},
            },
            {
                queryParams: {project_id: "project-1", application_id: "app-1"},
                abortSignal: undefined,
                headers: {"Idempotency-Key": "stop-1"},
            },
        )
        expect(result).toEqual({...response, accepted: true, conflict: false})
    })

    it("maps Fern 409 to the stale-execution conflict result", async () => {
        fernCancelSessionExecution.mockReturnValue({
            withRawResponse: () => Promise.reject({statusCode: 409}),
        })

        const result = await cancelSessionExecution({
            projectId: "project-1",
            sessionId: "session-1",
        })

        expect(result).toEqual({
            command: {id: "", state: "obsolete"},
            execution: {id: null, state: "idle"},
            accepted: false,
            conflict: true,
        })
    })

    it("accepts and normalizes the API flag-off legacy cancel payload", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
        fernCancelSessionExecution.mockReturnValue({
            withRawResponse: () =>
                Promise.resolve({
                    data: {
                        mode: "cancel",
                        session_id: "session-1",
                        turn_id: "turn-1",
                        watcher_id: null,
                        detached: true,
                        cancelled_turn_ids: [],
                    },
                    rawResponse: {status: 200},
                }),
        })

        const result = await cancelSessionExecution({
            projectId: "project-1",
            sessionId: "session-1",
            expectedExecutionId: "turn-1",
        })

        expect(result).toEqual({
            command: {id: "", state: "applied"},
            execution: {id: "turn-1", state: "idle"},
            accepted: true,
            conflict: false,
        })
        expect(consoleError).not.toHaveBeenCalled()
        consoleError.mockRestore()
    })

    it("rejects malformed successful payloads at the Zod boundary", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
        fernCancelSessionExecution.mockReturnValue({
            withRawResponse: () =>
                Promise.resolve({data: {command: null}, rawResponse: {status: 202}}),
        })

        await expect(
            cancelSessionExecution({projectId: "project-1", sessionId: "session-1"}),
        ).resolves.toBeNull()
        expect(consoleError).toHaveBeenCalled()
    })
})
