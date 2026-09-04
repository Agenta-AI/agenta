import {beforeEach, describe, expect, it, vi} from "vitest"

const setSessionStream = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: () => ({setSessionStream}),
    getLowPrioritySessionsClient: () => ({setSessionStream}),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

const {cancelSessionStream} = await import("../../src/session/api/api")

const params = {sessionId: "s1", projectId: "p1"}

const apiError = (statusCode: number, body?: unknown) =>
    Object.assign(new Error("AgentaApiError"), {name: "AgentaApiError", statusCode, body})

beforeEach(() => {
    setSessionStream.mockReset()
})

describe("cancelSessionStream", () => {
    it("reports the cancelled turns when the server accepts", async () => {
        setSessionStream.mockResolvedValue({
            mode: "cancel",
            session_id: "s1",
            turn_id: "turn-1",
            cancelled_turn_ids: ["turn-1"],
            detached: true,
        })

        const outcome = await cancelSessionStream(params)

        expect(outcome.status).toBe("cancelled")
        expect(outcome.status === "cancelled" && outcome.response?.turn_id).toBe("turn-1")
        expect(setSessionStream).toHaveBeenCalledWith({session_id: "s1"}, expect.anything())
    })

    it("reports idle when the server accepted but found no running turn", async () => {
        setSessionStream.mockResolvedValue({
            mode: "cancel",
            session_id: "s1",
            cancelled_turn_ids: [],
        })

        expect(await cancelSessionStream(params)).toEqual({status: "idle"})
    })

    it("reports failure when the response omits cancellation evidence", async () => {
        setSessionStream.mockResolvedValue({mode: "cancel", session_id: "s1"})

        expect(await cancelSessionStream(params)).toEqual({
            status: "failed",
            message: "Could not stop the run. It may still be running.",
        })
    })

    it("reports failure when the response cannot be parsed", async () => {
        setSessionStream.mockResolvedValue({unexpected: true})

        expect(await cancelSessionStream(params)).toEqual({
            status: "failed",
            message: "Could not stop the run. It may still be running.",
        })
    })

    it("sends the turn id as expected_execution_id when the client knows it", async () => {
        setSessionStream.mockResolvedValue({mode: "cancel", session_id: "s1"})

        await cancelSessionStream({...params, expectedExecutionId: "turn-7"})

        expect(setSessionStream).toHaveBeenCalledWith(
            {session_id: "s1", expected_execution_id: "turn-7"},
            expect.anything(),
        )
    })

    it("omits the field entirely when the client never learned the turn id", async () => {
        setSessionStream.mockResolvedValue({mode: "cancel", session_id: "s1"})

        await cancelSessionStream({...params, expectedExecutionId: undefined})

        expect(setSessionStream).toHaveBeenCalledWith({session_id: "s1"}, expect.anything())
    })

    it("reports a 409 as stale, carrying the server's own message", async () => {
        setSessionStream.mockRejectedValue(
            apiError(409, {
                detail: {
                    message:
                        "Session 's1' is running turn 'turn-2', not the expected turn 'turn-1'.",
                    expected_execution_id: "turn-1",
                    actual_execution_id: "turn-2",
                },
            }),
        )

        const outcome = await cancelSessionStream(params)

        expect(outcome.status).toBe("stale")
        expect(outcome.status === "stale" && outcome.message).toContain("turn-2")
    })

    it("falls back to plain wording when a 409 carries no readable message", async () => {
        setSessionStream.mockRejectedValue(apiError(409, {detail: {}}))

        const outcome = await cancelSessionStream(params)

        expect(outcome.status).toBe("stale")
        expect(outcome.status === "stale" && outcome.message.length).toBeGreaterThan(0)
    })

    it("reports any other error as failed, never as stale", async () => {
        setSessionStream.mockRejectedValue(apiError(500, {detail: {message: "Runner unavailable"}}))

        expect(await cancelSessionStream(params)).toEqual({
            status: "failed",
            message: "Runner unavailable",
        })
    })

    it("rethrows an abort so a cancelled query settles as cancelled", async () => {
        setSessionStream.mockRejectedValue(
            Object.assign(new Error("AgentaApiError"), {
                name: "AgentaApiError",
                message: "The user aborted a request",
            }),
        )

        await expect(cancelSessionStream(params)).rejects.toThrow()
    })

    it("is a no-op without a project or a session", async () => {
        expect((await cancelSessionStream({sessionId: "s1", projectId: ""})).status).toBe("failed")
        expect(setSessionStream).not.toHaveBeenCalled()
    })
})
