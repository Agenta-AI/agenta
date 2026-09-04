// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {describe, expect, it, vi} from "vitest"

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
})
