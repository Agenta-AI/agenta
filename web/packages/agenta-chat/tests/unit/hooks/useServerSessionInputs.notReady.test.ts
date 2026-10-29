// @vitest-environment jsdom
/**
 * The durable (queued) send builds its request once. The first message to a newly created agent
 * races the workflow's invocation-URL fetch, so a single build returned null and the send failed
 * with "The agent is not ready to accept input." The send now waits, within the same bounded
 * deadline the direct path used, for the request to become buildable.
 */
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {PREPARE_REQUEST_TIMEOUT_MS} from "../../../src/assets/boundedRequest"
import {useServerSessionInputs} from "../../../src/hooks/useServerSessionInputs"

const {buildAgentRequest, fetchSnapshot} = vi.hoisted(() => ({
    buildAgentRequest: vi.fn(),
    fetchSnapshot: vi.fn(),
}))

vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/session")>()),
        fetchSessionSnapshotAtom: atom(null, (_get, _set, sessionId: string) =>
            fetchSnapshot(sessionId),
        ),
    }
})

vi.mock("@agenta/playground/agent-chat", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/playground/agent-chat")>()),
    buildAgentRequest,
}))

const fetchMock = vi.fn<typeof globalThis.fetch>()
vi.stubGlobal("fetch", fetchMock)

const readyRequest = {
    invocationUrl: "https://agent.test/invoke",
    headers: {Accept: "text/event-stream"},
    requestBody: {session_id: "session-1", data: {inputs: {messages: []}}},
}

const renderInputs = () =>
    renderHook(
        ({sessionId}: {sessionId: string}) =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId,
                messages: [] as UIMessage[],
                locallyBusy: false,
            }),
        {initialProps: {sessionId: "session-1"}},
    )

describe("durable send before the invocation URL has loaded", () => {
    beforeEach(() => {
        buildAgentRequest.mockReset()
        fetchSnapshot.mockReset()
        fetchSnapshot.mockResolvedValue(null)
        fetchMock.mockReset()
        fetchMock.mockResolvedValue(new Response(null, {status: 202}))
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it("sends the first message once the invocation URL appears", async () => {
        let invocationUrlLoaded = false
        buildAgentRequest.mockImplementation(async () =>
            invocationUrlLoaded ? readyRequest : null,
        )
        const {result} = renderInputs()

        let outcome: Promise<unknown> = Promise.resolve()
        await act(async () => {
            outcome = result.current.submit({id: "first", text: "hello", source: "local"}, "queue")
            await vi.advanceTimersByTimeAsync(1_000)
        })
        expect(fetchMock).not.toHaveBeenCalled()

        invocationUrlLoaded = true
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000)
            await outcome
        })

        await expect(outcome).resolves.toBe("queued")
        expect(buildAgentRequest.mock.calls.length).toBeGreaterThan(1)
        expect(fetchMock).toHaveBeenCalledOnce()
        expect(fetchMock).toHaveBeenCalledWith(
            "https://agent.test/invoke",
            expect.objectContaining({
                headers: expect.objectContaining({"Idempotency-Key": "first"}),
            }),
        )
    })

    it("still fails with the existing message when the URL never loads", async () => {
        buildAgentRequest.mockResolvedValue(null)
        const {result} = renderInputs()

        let outcome: Promise<unknown> = Promise.resolve()
        await act(async () => {
            outcome = result.current.submit({id: "first", text: "hello", source: "local"}, "queue")
            outcome.catch(() => undefined)
            await vi.advanceTimersByTimeAsync(PREPARE_REQUEST_TIMEOUT_MS + 1_000)
        })

        await expect(outcome).rejects.toThrow("The agent is not ready to accept input.")
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("does not send when the session changes while the URL loads", async () => {
        let invocationUrlLoaded = false
        buildAgentRequest.mockImplementation(async () =>
            invocationUrlLoaded ? readyRequest : null,
        )
        const {result, rerender} = renderInputs()

        let outcome: Promise<unknown> = Promise.resolve()
        await act(async () => {
            outcome = result.current.submit({id: "first", text: "hello", source: "local"}, "queue")
            outcome.catch(() => undefined)
            await vi.advanceTimersByTimeAsync(1_000)
        })

        rerender({sessionId: "session-2"})
        invocationUrlLoaded = true
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1_000)
        })

        await expect(outcome).rejects.toThrow("The session changed before the message was sent.")
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
