// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import type {FileUIPart, UIMessage} from "ai"
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

const assistantContinuation = (
    id: string,
    state: "running" | "done" | "error",
): UIMessage =>
    ({
        ...assistantAwaitingApproval(id),
        metadata: {
            ...(state === "done" ? {recordTerminal: true} : {}),
            approvalContinuation: {
                sourceExecutionId: `${id}-source-execution`,
                executionId: `${id}-continuation-execution`,
                state,
                approvalIds: [`${id}-approval`],
            },
        },
        parts: [
            {
                type: "tool-send_email",
                state: "approval-responded",
                toolCallId: `${id}-call`,
                input: {to: "a@b.c"},
                approval: {id: `${id}-approval`, approved: true},
            },
        ],
    }) as unknown as UIMessage

interface HarnessProps {
    status: string
    messages: UIMessage[]
    stopped: boolean
    acceptedRunPending?: boolean
    resumeOrphaned?: boolean
    recoverable?: boolean
    sessionId?: string
}

const setup = (initial: HarnessProps) => {
    const sendQueued = vi.fn()
    const retryContinuation = vi.fn(() => Promise.resolve(true))
    const view = renderHook(
        (props: HarnessProps) =>
            useAgentChatQueue({...props, sendQueued, retryContinuation}),
        {initialProps: initial},
    )
    return {sendQueued, retryContinuation, ...view}
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

    it("holds an accepted turn after its sender stream errors until the shared path settles", () => {
        const acceptedDisconnect: HarnessProps = {
            status: "error",
            messages: [userTurn("u1", "go")],
            stopped: false,
            acceptedRunPending: true,
        }
        const {result, rerender, sendQueued} = setup(acceptedDisconnect)

        act(() => result.current.submit({text: "hold behind the accepted turn"}))

        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued.map((message) => message.text)).toEqual([
            "hold behind the accepted turn",
        ])

        rerender({...acceptedDisconnect, acceptedRunPending: false})

        expect(sendQueued).toHaveBeenCalledTimes(1)
        expect(sendQueued.mock.calls[0][0]).toMatchObject({text: "hold behind the accepted turn"})
        expect(result.current.queued).toHaveLength(0)
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

    it("keeps a recoverable Send visible and retries the saved continuation", () => {
        const paused: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
            recoverable: true,
        }
        const {result, sendQueued, retryContinuation} = setup(paused)

        act(() => result.current.submit({text: "send after the approval"}))

        expect(sendQueued).not.toHaveBeenCalled()
        expect(retryContinuation).toHaveBeenCalledOnce()
        expect(result.current.queued.map((message) => message.text)).toEqual([
            "send after the approval",
        ])
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

    it("holds through a different continuation execution and drains once after its terminal", () => {
        const paused: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
        }
        const {result, rerender, sendQueued} = setup(paused)
        act(() => result.current.submit({text: "after continuation"}))

        rerender({
            ...paused,
            messages: [userTurn("u1", "go"), assistantContinuation("a1", "running")],
        })
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued).toHaveLength(1)

        rerender({
            ...paused,
            messages: [userTurn("u1", "go"), assistantContinuation("a1", "done")],
        })

        expect(sendQueued).toHaveBeenCalledOnce()
        expect(sendQueued.mock.calls[0][0]).toMatchObject({text: "after continuation"})
        expect(result.current.queued).toHaveLength(0)

        rerender({
            ...paused,
            messages: [userTurn("u1", "go"), assistantContinuation("a1", "done")],
        })
        expect(sendQueued).toHaveBeenCalledOnce()
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

    it("removeQueued edits the held list without sending", () => {
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
        // Empty the session store again — it outlives the test, keyed on this id.
        act(() => {
            second.result.current.removeQueued(second.result.current.queued[0].id)
        })
    })

    it("rewrites the edited message in place, keeping its position and attachments", () => {
        const streaming: HarnessProps = {
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
        }
        const {result, sendQueued} = setup(streaming)
        const png = {type: "file", url: "data:,", mediaType: "image/png"} as FileUIPart
        act(() => {
            result.current.submit({text: "one"})
            result.current.submit({text: "two", fileParts: [png]})
            result.current.submit({text: "three"})
        })
        const secondId = result.current.queued[1].id
        act(() => {
            result.current.beginEdit(secondId, "half-typed draft")
        })
        expect(result.current.editingId).toBe(secondId)
        act(() => {
            result.current.commitEdit({text: "two, rewritten"})
        })
        expect(result.current.queued.map((m) => m.text)).toEqual(["one", "two, rewritten", "three"])
        // Same message, not a re-queued copy at the tail.
        expect(result.current.queued[1].id).toBe(secondId)
        // The composer submits only NEWLY staged files, so a text-only edit must keep the originals.
        expect(result.current.queued[1].fileParts).toEqual([png])
        expect(result.current.editingId).toBeNull()
        expect(sendQueued).not.toHaveBeenCalled()
    })

    it("hands the stashed composer draft back when an edit is cancelled", () => {
        const {result} = setup({
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
        })
        act(() => {
            result.current.submit({text: "one"})
        })
        const id = result.current.queued[0].id
        act(() => {
            result.current.beginEdit(id, "half-typed draft")
        })
        let restored = ""
        act(() => {
            restored = result.current.cancelEdit()
        })
        expect(restored).toBe("half-typed draft")
        expect(result.current.editingId).toBeNull()
        expect(result.current.queued.map((m) => m.text)).toEqual(["one"])
    })

    it("hands the stashed draft back on commit too, and only once", () => {
        const {result} = setup({
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
        })
        act(() => {
            result.current.submit({text: "one"})
        })
        const id = result.current.queued[0].id
        act(() => {
            result.current.beginEdit(id, "half-typed draft")
        })
        let restored = ""
        act(() => {
            restored = result.current.commitEdit({text: "one, rewritten"})
        })
        // Committing consumes the composer, so the displaced draft must come back here as well —
        // otherwise typing then editing silently destroys what was typed.
        expect(restored).toBe("half-typed draft")
        expect(result.current.queued.map((m) => m.text)).toEqual(["one, rewritten"])
        // A second session with no draft must not resurrect the old one.
        act(() => {
            result.current.beginEdit(id)
        })
        let second = "unset"
        act(() => {
            second = result.current.cancelEdit()
        })
        expect(second).toBe("")
    })

    it("queues a new message when the edited one drained mid-edit", () => {
        const streaming: HarnessProps = {
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
        }
        const {result, rerender, sendQueued} = setup(streaming)
        act(() => {
            result.current.submit({text: "one"})
            result.current.submit({text: "two"})
        })
        const headId = result.current.queued[0].id
        act(() => {
            result.current.beginEdit(headId, "")
        })
        // The turn settles while the user is still editing, so the head is released.
        act(() => {
            rerender({...streaming, status: "ready"})
        })
        expect(sendQueued).toHaveBeenCalledTimes(1)
        expect(sendQueued.mock.calls[0][0].text).toBe("one")
        act(() => {
            result.current.commitEdit({text: "one, but better"})
        })
        // Nothing was left to rewrite, so the content becomes a message of its own rather than
        // disappearing — the tail, because the queue still holds "two".
        expect(result.current.queued.map((m) => m.text)).toEqual(["two", "one, but better"])
        expect(result.current.editingId).toBeNull()
    })

    it("drops a message edited down to nothing", () => {
        const {result} = setup({
            status: "streaming",
            messages: [userTurn("u1", "go")],
            stopped: false,
        })
        act(() => {
            result.current.submit({text: "one"})
            result.current.submit({text: "two"})
        })
        const headId = result.current.queued[0].id
        act(() => {
            result.current.beginEdit(headId, "")
        })
        act(() => {
            result.current.commitEdit({text: "   "})
        })
        expect(result.current.queued.map((m) => m.text)).toEqual(["two"])
    })
})

describe("useAgentChatQueue: reclaiming a sent message", () => {
    // The host reclaims an immediate send only until the runner confirms admission.

    it("hands back the message that was sent immediately", () => {
        const {result} = setup(settledEmpty)
        act(() => {
            result.current.submit({text: "the refused message"})
        })
        expect(result.current.takeLastSent()).toMatchObject({text: "the refused message"})
    })

    it("hands it back only ONCE, so a re-render cannot re-fill the composer", () => {
        const {result} = setup(settledEmpty)
        act(() => {
            result.current.submit({text: "once"})
        })
        expect(result.current.takeLastSent()?.text).toBe("once")
        expect(result.current.takeLastSent()).toBeUndefined()
    })

    it("keeps an attachment-only refused send recoverable", () => {
        const {result} = setup(settledEmpty)
        const stagedFiles = [{uid: "file-1", name: "brief.pdf", status: "done"}] as never
        act(() => {
            result.current.submit({text: "", stagedFiles})
        })

        expect(result.current.takeLastSent()).toMatchObject({text: "", stagedFiles})
    })

    it("retains a refused send when the composer cannot place it", () => {
        const {result} = setup(settledEmpty)
        const stagedFiles = [{uid: "file-1", name: "brief.pdf", status: "done"}] as never
        act(() => {
            result.current.submit({text: "refused message", stagedFiles})
        })

        expect(result.current.takeLastSent(() => false)).toBeUndefined()
        expect(result.current.takeLastSent()).toMatchObject({
            text: "refused message",
            stagedFiles,
        })
    })

    it("does not clear recovery when dispatch only changes the stream status", () => {
        const {result, rerender} = setup(settledEmpty)
        act(() => {
            result.current.submit({text: "sent"})
        })
        rerender({status: "streaming", messages: [userTurn("u1", "sent")], stopped: false})
        expect(result.current.takeLastSent()?.text).toBe("sent")
    })

    it("clears recovery after a runner turn id confirms admission", () => {
        const {result, rerender} = setup(settledEmpty)
        act(() => {
            result.current.submit({text: "admitted"})
        })
        rerender({
            status: "streaming",
            messages: [
                userTurn("u2", "admitted"),
                {...assistantText("a2", ""), metadata: {turnId: "turn-2"}},
            ],
            stopped: false,
        })
        expect(result.current.takeLastSent()).toBeUndefined()
    })

    it("has nothing to hand back for a message that only QUEUED", () => {
        // A queued message is already safe: it is rendered by the dock and mirrored per session.
        const {result, sendQueued} = setup({status: "streaming", messages: [], stopped: false})
        act(() => {
            result.current.submit({text: "queued, not sent"})
        })
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued).toHaveLength(1)
        expect(result.current.takeLastSent()).toBeUndefined()
    })

    it("tracks the released queue head too, which the release removed from the queue", () => {
        const {result, rerender} = setup({status: "streaming", messages: [], stopped: false})
        act(() => {
            result.current.submit({text: "held"})
        })
        expect(result.current.queued).toHaveLength(1)
        act(() => {
            rerender({status: "ready", messages: [], stopped: false})
        })
        expect(result.current.queued).toHaveLength(0)
        expect(result.current.takeLastSent()).toMatchObject({text: "held"})
    })
})
