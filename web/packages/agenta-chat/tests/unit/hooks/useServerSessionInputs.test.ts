// @vitest-environment jsdom
import {act, renderHook, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const {buildAgentRequest, fetchSnapshot, removeInput} = vi.hoisted(() => ({
    buildAgentRequest: vi.fn(),
    fetchSnapshot: vi.fn(),
    removeInput: vi.fn(),
}))

vi.mock("@agenta/entities/session", async () => {
    const {atom} = await import("jotai")
    return {
        fetchSessionSnapshotAtom: atom(null, (_get, _set, sessionId: string) =>
            fetchSnapshot(sessionId),
        ),
        removePendingSessionInputAtom: atom(
            null,
            (_get, _set, params: {sessionId: string; inputId: string}) => removeInput(params),
        ),
    }
})

vi.mock("@agenta/playground/agent-chat", () => ({buildAgentRequest}))

import {useServerSessionInputs} from "../../../src/hooks/useServerSessionInputs"

const fetchMock = vi.fn<typeof globalThis.fetch>()
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
    buildAgentRequest.mockReset()
    fetchSnapshot.mockReset()
    removeInput.mockReset()
    fetchMock.mockReset()
})

describe("useServerSessionInputs", () => {
    it("reads queue support from the snapshot and submits durable admission", async () => {
        fetchSnapshot.mockResolvedValue({
            session: null,
            execution: {id: "turn-1", state: "running"},
            pending: {inputs: [], interactions: []},
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })
        buildAgentRequest.mockResolvedValue({
            invocationUrl: "https://agent.test/invoke",
            headers: {Accept: "text/event-stream"},
            requestBody: {session_id: "session-1", data: {inputs: {messages: []}}},
        })
        fetchMock.mockResolvedValue(new Response(null, {status: 202}))

        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [] as UIMessage[],
                locallyBusy: true,
            }),
        )

        await waitFor(() => expect(result.current.capabilities.queue).toBe(true))

        await act(async () => {
            await result.current.submit(
                {id: "input-1", text: "run this next", source: "local"},
                "queue",
            )
        })

        expect(fetchSnapshot).toHaveBeenCalledWith("session-1")
        expect(buildAgentRequest).toHaveBeenCalledWith(
            "revision-1",
            [expect.objectContaining({id: "input-1", role: "user"})],
            {sessionId: "session-1"},
        )
        expect(fetchMock).toHaveBeenCalledWith(
            "https://agent.test/invoke",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({"Idempotency-Key": "input-1"}),
                body: JSON.stringify({
                    session_id: "session-1",
                    data: {inputs: {messages: []}},
                    on_busy: "queue",
                }),
            }),
        )
    })
})
