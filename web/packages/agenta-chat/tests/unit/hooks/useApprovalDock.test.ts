// @vitest-environment jsdom
import type {SessionInteractionRowStates} from "@agenta/entities/session"
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {describe, expect, it, vi} from "vitest"

import {reconcileInteractionRowStates} from "../../../src/assets/transcriptToMessages"
import {useApprovalDock} from "../../../src/hooks/useApprovalDock"

const gatePart = (approvalId: string, toolName = "send_email") => ({
    type: `tool-${toolName}`,
    state: "approval-requested",
    toolCallId: `${approvalId}-call`,
    input: {gate: approvalId},
    approval: {id: approvalId},
})

const assistantWithGates = (...approvalIds: string[]): UIMessage =>
    ({
        id: "a1",
        role: "assistant",
        parts: approvalIds.map((id) => gatePart(id)),
    }) as unknown as UIMessage

const userTurn: UIMessage = {
    id: "u1",
    role: "user",
    parts: [{type: "text", text: "go"}],
} as UIMessage

const settledAssistant: UIMessage = {
    id: "a1",
    role: "assistant",
    parts: [{type: "text", text: "done"}],
} as UIMessage

const setup = (messages: UIMessage[]) => {
    const respond = vi.fn()
    const view = renderHook(
        (props: {messages: UIMessage[]}) => useApprovalDock({messages: props.messages, respond}),
        {initialProps: {messages}},
    )
    return {respond, ...view}
}

describe("useApprovalDock", () => {
    it("is closed with no pending gates", () => {
        const {result} = setup([userTurn, settledAssistant])
        expect(result.current.open).toBe(false)
        expect(result.current.current).toBeNull()
        expect(result.current.count).toBe(0)
        // respond on an empty dock is a no-op.
        act(() => {
            result.current.respond(true)
        })
        expect(result.current.responding).toBe(false)
    })

    it("extracts the paused turn's gates: first is current, count covers the batch", () => {
        const {result} = setup([userTurn, assistantWithGates("g1", "g2", "g3")])
        expect(result.current.open).toBe(true)
        expect(result.current.count).toBe(3)
        expect(result.current.current?.approvalId).toBe("g1")
        expect(result.current.current?.toolName).toBe("send_email")
    })

    it("respond answers the current gate once and latches until the gate changes", () => {
        const {result, rerender, respond} = setup([userTurn, assistantWithGates("g1", "g2")])
        act(() => {
            result.current.respond(true)
        })
        expect(respond).toHaveBeenCalledTimes(1)
        expect(respond).toHaveBeenCalledWith({id: "g1", approved: true})
        expect(result.current.responding).toBe(true)
        // A second click while responding is swallowed.
        act(() => {
            result.current.respond(false)
        })
        expect(respond).toHaveBeenCalledTimes(1)
        // The SDK settles g1 → the next gate slides in and responding resets.
        rerender({messages: [userTurn, assistantWithGates("g2")]})
        expect(result.current.current?.approvalId).toBe("g2")
        expect(result.current.responding).toBe(false)
        act(() => {
            result.current.respond(false)
        })
        expect(respond).toHaveBeenCalledWith({id: "g2", approved: false})
    })

    it("approveAll fans out to every gate and freezes the shown set while they settle", () => {
        const {result, rerender, respond} = setup([userTurn, assistantWithGates("g1", "g2")])
        act(() => {
            result.current.approveAll()
        })
        expect(respond).toHaveBeenCalledTimes(2)
        expect(respond).toHaveBeenNthCalledWith(1, {id: "g1", approved: true})
        expect(respond).toHaveBeenNthCalledWith(2, {id: "g2", approved: true})
        // g1 settles first — the card must NOT step to "1 of 1"; the shown set stays frozen.
        rerender({messages: [userTurn, assistantWithGates("g2")]})
        expect(result.current.count).toBe(2)
        expect(result.current.current?.approvalId).toBe("g1")
        expect(result.current.responding).toBe(true)
        // All settle → the dock closes in one step.
        rerender({messages: [userTurn, settledAssistant]})
        expect(result.current.open).toBe(false)
    })

    it("approveAll uses one batch response when the host supports it", () => {
        const respond = vi.fn()
        const respondAll = vi.fn()
        const {result} = renderHook(() =>
            useApprovalDock({
                messages: [userTurn, assistantWithGates("g1", "g2")],
                respond,
                respondAll,
            }),
        )

        act(() => result.current.approveAll())

        expect(respond).not.toHaveBeenCalled()
        expect(respondAll).toHaveBeenCalledOnce()
        expect(respondAll).toHaveBeenCalledWith({ids: ["g1", "g2"], approved: true})
    })

    it("keeps the last card latched while closed so a leave transition has content", () => {
        const {result, rerender} = setup([userTurn, assistantWithGates("g1")])
        expect(result.current.current?.approvalId).toBe("g1")
        rerender({messages: [userTurn, settledAssistant]})
        expect(result.current.open).toBe(false)
        // The latched gate is still available for the closing animation frame.
        expect(result.current.current?.approvalId).toBe("g1")
    })

    it("closes when the continuation reaches a terminal record", () => {
        const terminal = {
            ...assistantWithGates("g1"),
            metadata: {
                approvalContinuation: {
                    sourceExecutionId: "source-turn",
                    executionId: "continuation-turn",
                    state: "done",
                    approvalIds: ["g1"],
                },
            },
        } as UIMessage

        const {result} = setup([userTurn, terminal])

        expect(result.current.open).toBe(false)
    })

    it("closes when another reader resolves the interaction row", () => {
        const pending = assistantWithGates("g1")
        const rows: SessionInteractionRowStates = new Map([
            [
                "g1",
                {
                    token: "g1",
                    kind: "user_approval",
                    status: "resolved",
                    resolution: {verdict: "approved"},
                },
            ],
        ])
        const reconciled = reconcileInteractionRowStates([pending], rows)
        const {result} = setup(reconciled)

        expect(result.current.open).toBe(false)
    })

    it("moves from sending to answered only after the response promise resolves", async () => {
        let accept: (() => void) | undefined
        const respond = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    accept = resolve
                }),
        )
        const {result} = renderHook(() =>
            useApprovalDock({messages: [assistantWithGates("g1")], respond}),
        )

        act(() => result.current.respond(true))
        expect(result.current.responding).toBe(true)
        expect(result.current.answered).toBe(false)

        await act(async () => accept?.())
        expect(result.current.answered).toBe(true)
        expect(result.current.errorText).toBeNull()
    })

    it("re-arms the pending decision and shows an error when submission fails", async () => {
        const respond = vi.fn(() => Promise.reject(new Error("Network unavailable")))
        const {result} = renderHook(() =>
            useApprovalDock({messages: [assistantWithGates("g1")], respond}),
        )

        await act(async () => result.current.respond(false))

        expect(result.current.responding).toBe(false)
        expect(result.current.answered).toBe(false)
        expect(result.current.errorText).toBe("Network unavailable")
        act(() => result.current.respond(false))
        expect(respond).toHaveBeenCalledTimes(2)
    })

    it("preserves a recoverable durable response for the shared card", async () => {
        const respond = vi.fn(() => Promise.resolve({durable: true, recoverable: true}))
        const {result} = renderHook(() =>
            useApprovalDock({messages: [assistantWithGates("g1")], respond}),
        )

        await act(async () => result.current.respond(true))

        expect(result.current.answered).toBe(true)
        expect(result.current.recoverable).toBe(true)
    })

    it("does not apply a late recoverable result to the next interaction", async () => {
        let resolveFirst: ((value: {durable: boolean; recoverable: boolean}) => void) | undefined
        const respond = vi.fn(
            () =>
                new Promise<{durable: boolean; recoverable: boolean}>((resolve) => {
                    resolveFirst = resolve
                }),
        )
        const {result, rerender} = renderHook(
            (props: {messages: UIMessage[]}) =>
                useApprovalDock({messages: props.messages, respond}),
            {initialProps: {messages: [assistantWithGates("g1")]}},
        )

        act(() => result.current.respond(true))
        rerender({messages: [assistantWithGates("g2")]})
        await act(async () => resolveFirst?.({durable: true, recoverable: true}))

        expect(result.current.current?.approvalId).toBe("g2")
        expect(result.current.answered).toBe(false)
        expect(result.current.recoverable).toBe(false)
    })
})

describe("host-driven dismiss", () => {
    // A chat message sent over a pending approval replaces it: every shown gate is denied, then
    // the host steers the message into the resumed run.
    it("denies every shown gate in one write and closes the dock", async () => {
        const respond = vi.fn()
        const respondAll = vi.fn().mockResolvedValue(undefined)
        const {result} = renderHook(() =>
            useApprovalDock({
                messages: [userTurn, assistantWithGates("g1", "g2")],
                respond,
                respondAll,
            }),
        )

        await act(async () => {
            await result.current.dismiss()
        })

        expect(respondAll).toHaveBeenCalledExactlyOnceWith({ids: ["g1", "g2"], approved: false})
        expect(respond).not.toHaveBeenCalled()
        expect(result.current.open).toBe(false)
    })

    it("gives the gates back and lets the failure through when the denial fails", async () => {
        const respond = vi.fn().mockRejectedValue(new Error("offline"))
        const {result} = renderHook(() =>
            useApprovalDock({messages: [userTurn, assistantWithGates("g1")], respond}),
        )

        await act(async () => {
            await expect(result.current.dismiss()).rejects.toThrow("offline")
        })

        expect(respond).toHaveBeenCalledExactlyOnceWith({id: "g1", approved: false})
        expect(result.current.open).toBe(true)
    })

    it("gives the gates back instead of letting a message steer into a run that will not resume", async () => {
        // A recoverable denial is recorded, but nothing resumes until the user sends again.
        const respondAll = vi.fn().mockResolvedValue({durable: true, recoverable: true})
        const {result} = renderHook(() =>
            useApprovalDock({
                messages: [userTurn, assistantWithGates("g1")],
                respond: vi.fn(),
                respondAll,
            }),
        )

        await act(async () => {
            await expect(result.current.dismiss()).rejects.toThrow("didn't resume")
        })

        expect(result.current.open).toBe(true)
        expect(result.current.recoverable).toBe(true)
    })

    it("does nothing when no gate is pending", async () => {
        const {result, respond} = setup([userTurn, settledAssistant])
        await act(async () => {
            await result.current.dismiss()
        })
        expect(respond).not.toHaveBeenCalled()
    })
})
