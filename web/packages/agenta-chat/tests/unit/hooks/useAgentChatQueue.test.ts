// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {describe, expect, it, vi} from "vitest"

import {useAgentChatQueue} from "../../../src/hooks/useAgentChatQueue"

// The pure release predicates (`canReleaseQueuedMessage`, `isHitlPending`) are unit-tested in
// the playground package; these tests cover the HOOK's stateful behavior on top of them:
// queue-while-streaming, one-per-settle FIFO release, the HITL hold, the stop/orphan voids,
// and per-session queue restoration across remounts.

const userTurn = (id: string, text: string): UIMessage =>
    ({id, role: "user", parts: [{type: "text", text}]}) as UIMessage

const assistantText = (id: string, text: string): UIMessage =>
    ({id, role: "assistant", parts: [{type: "text", text}]}) as UIMessage

/** An assistant tail paused on a HITL tool gate (the dock-actionable state). */
const assistantAwaitingApproval = (id: string): UIMessage =>
    ({
        id,
        role: "assistant",
        parts: [
            {
                type: "tool-send_email",
                state: "approval-requested",
                toolCallId: `${id}-call`,
                input: {to: "a@b.c"},
                approval: {id: `${id}-approval`},
            },
        ],
    }) as unknown as UIMessage

interface HarnessProps {
    status: string
    messages: UIMessage[]
    stopped: boolean
    resumeOrphaned?: boolean
    sessionId?: string
}

const setup = (initial: HarnessProps) => {
    const sendQueued = vi.fn()
    const view = renderHook((props: HarnessProps) => useAgentChatQueue({...props, sendQueued}), {
        initialProps: initial,
    })
    return {sendQueued, ...view}
}

const settledEmpty: HarnessProps = {status: "ready", messages: [], stopped: false}

describe("useAgentChatQueue", () => {
    it("sends immediately when settled, unlatched, and the queue is empty", () => {
        const {result, sendQueued} = setup(settledEmpty)
        act(() => {
            result.current.submit({text: "hello"})
        })
        expect(sendQueued).toHaveBeenCalledTimes(1)
        expect(sendQueued.mock.calls[0][0]).toMatchObject({text: "hello"})
        expect(result.current.queued).toHaveLength(0)
    })

    it("queues messages typed while a turn is streaming", () => {
        const {result, sendQueued} = setup({
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
        })
        act(() => {
            result.current.submit({text: "first"})
        })
        act(() => {
            result.current.submit({text: "second"})
        })
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued.map((m) => m.text)).toEqual(["first", "second"])
    })

    it("releases held messages one per settle, in FIFO order", () => {
        const streaming: HarnessProps = {
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
        }
        const {result, rerender, sendQueued} = setup(streaming)
        act(() => {
            result.current.submit({text: "first"})
            result.current.submit({text: "second"})
        })
        // Stream settles → only the head releases (the latch caps it at one per settle).
        rerender({...streaming, status: "ready", messages: [assistantText("a1", "done")]})
        expect(sendQueued).toHaveBeenCalledTimes(1)
        expect(sendQueued.mock.calls[0][0]).toMatchObject({text: "first"})
        expect(result.current.queued.map((m) => m.text)).toEqual(["second"])
        // The released message flips the conversation busy again; the next settle releases #2.
        rerender({...streaming, status: "streaming"})
        rerender({...streaming, status: "ready", messages: [assistantText("a2", "done")]})
        expect(sendQueued).toHaveBeenCalledTimes(2)
        expect(sendQueued.mock.calls[1][0]).toMatchObject({text: "second"})
        expect(result.current.queued).toHaveLength(0)
    })

    it("holds the queue (and reports hitlPending) while a HITL approval is pending", () => {
        const paused: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
        }
        const {result, sendQueued} = setup(paused)
        expect(result.current.hitlPending).toBe(true)
        act(() => {
            result.current.submit({text: "while paused"})
        })
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued.map((m) => m.text)).toEqual(["while paused"])
    })

    it("releases a held message once the approval gate resolves", () => {
        const paused: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
        }
        const {result, rerender, sendQueued} = setup(paused)
        act(() => {
            result.current.submit({text: "held"})
        })
        expect(sendQueued).not.toHaveBeenCalled()
        // The approved tool ran and the resumed turn settled with real output.
        rerender({...paused, messages: [userTurn("u1", "go"), assistantText("a2", "sent")]})
        expect(sendQueued).toHaveBeenCalledTimes(1)
        expect(sendQueued.mock.calls[0][0]).toMatchObject({text: "held"})
        expect(result.current.queued).toHaveLength(0)
    })

    it("a user stop voids the HITL hold: settled sends go immediately and hitlPending clears", () => {
        const stoppedPaused: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: true,
        }
        const {result, sendQueued} = setup(stoppedPaused)
        expect(result.current.hitlPending).toBe(false)
        act(() => {
            result.current.submit({text: "after stop"})
        })
        expect(sendQueued).toHaveBeenCalledTimes(1)
        expect(sendQueued.mock.calls[0][0]).toMatchObject({text: "after stop"})
    })

    it("an orphaned restored resume shape voids the hold the same way", () => {
        // `approval-responded` with no live interaction = the pre-resume hold that can never fire.
        const orphanTail = {
            id: "a1",
            role: "assistant",
            parts: [
                {
                    type: "tool-send_email",
                    state: "approval-responded",
                    toolCallId: "a1-call",
                    input: {},
                    approval: {id: "a1-approval", approved: true},
                },
            ],
        } as unknown as UIMessage
        const base: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), orphanTail],
            stopped: false,
        }
        // Without the orphan flag the pre-resume hold applies…
        const held = setup(base)
        act(() => {
            held.result.current.submit({text: "queued"})
        })
        expect(held.sendQueued).not.toHaveBeenCalled()
        // …with it, the settled conversation is releasable.
        const released = setup({...base, resumeOrphaned: true})
        act(() => {
            released.result.current.submit({text: "released"})
        })
        expect(released.sendQueued).toHaveBeenCalledTimes(1)
    })

    it("removeQueued and clearQueue edit the held list without sending", () => {
        const streaming: HarnessProps = {
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
        }
        const {result, sendQueued} = setup(streaming)
        act(() => {
            result.current.submit({text: "one"})
            result.current.submit({text: "two"})
            result.current.submit({text: "three"})
        })
        const secondId = result.current.queued[1].id
        act(() => {
            result.current.removeQueued(secondId)
        })
        expect(result.current.queued.map((m) => m.text)).toEqual(["one", "three"])
        act(() => {
            result.current.clearQueue()
        })
        expect(result.current.queued).toHaveLength(0)
        expect(sendQueued).not.toHaveBeenCalled()
    })

    it("restores a held queue for the same session across a remount", () => {
        const sessionId = `queue-restore-${Date.now()}`
        const streaming: HarnessProps = {
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
            sessionId,
        }
        const first = setup(streaming)
        act(() => {
            first.result.current.submit({text: "survives"})
        })
        first.unmount()
        // A fresh mount under the same session id picks the held message back up…
        const second = setup(streaming)
        expect(second.result.current.queued.map((m) => m.text)).toEqual(["survives"])
        // …and a different session starts empty.
        const other = setup({...streaming, sessionId: `${sessionId}-other`})
        expect(other.result.current.queued).toHaveLength(0)
        act(() => {
            second.result.current.clearQueue()
        })
    })
})
