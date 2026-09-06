import {beforeEach, describe, expect, it, vi} from "vitest"

const {fetchSnapshot, removeInput} = vi.hoisted(() => ({
    fetchSnapshot: vi.fn(),
    removeInput: vi.fn(),
}))

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({
        getSessionSnapshot: fetchSnapshot,
        removePendingSessionInput: removeInput,
    }),
    getLowPrioritySessionsClient: vi.fn(),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {
    fetchSessionSnapshot as readSnapshot,
    removePendingSessionInput,
} from "../../src/session/api/api"

beforeEach(() => {
    fetchSnapshot.mockReset()
    removeInput.mockReset()
})

describe("session pending-input API", () => {
    it("reads the shared snapshot through the scoped Fern client", async () => {
        fetchSnapshot.mockResolvedValue({
            session: {
                id: "11111111-1111-4111-8111-111111111111",
                project_id: "22222222-2222-4222-8222-222222222222",
                session_id: "session/1",
            },
            execution: null,
            execution_state: {state: "running"},
            pending: {inputs: [], interactions: []},
            read: {latest_sequence: 0, history_complete: true},
            capabilities: {queue: true, steer: false},
        })

        await expect(
            readSnapshot({projectId: "project-1", sessionId: "session/1"}),
        ).resolves.toMatchObject({capabilities: {queue: true, steer: false}})
        expect(fetchSnapshot).toHaveBeenCalledWith(
            {session_id: "session/1"},
            expect.objectContaining({queryParams: {project_id: "project-1"}}),
        )
    })

    it("accepts a queue snapshot without reconnect data", async () => {
        fetchSnapshot.mockResolvedValue({
            session: null,
            execution: null,
            execution_state: {state: "idle"},
            pending: {inputs: [], interactions: []},
            read: null,
            capabilities: {queue: true, steer: true},
        })

        await expect(
            readSnapshot({projectId: "project-1", sessionId: "session-1"}),
        ).resolves.toMatchObject({
            session: null,
            execution: null,
            read: null,
            execution_state: {state: "idle"},
            capabilities: {queue: true, steer: true},
        })
    })

    it("removes a pending input through the generated route", async () => {
        removeInput.mockResolvedValue({input: {id: "input-1"}})

        await expect(
            removePendingSessionInput({
                projectId: "project-1",
                sessionId: "session/1",
                inputId: "input-1",
            }),
        ).resolves.toBe(true)
        expect(removeInput).toHaveBeenCalledWith(
            {session_id: "session/1", input_id: "input-1"},
            expect.objectContaining({queryParams: {project_id: "project-1"}}),
        )
    })
})
