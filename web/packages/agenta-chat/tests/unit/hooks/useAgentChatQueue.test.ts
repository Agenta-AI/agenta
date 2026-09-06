// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
import type {FileUIPart, UIMessage} from "ai"
import {describe, expect, it, vi} from "vitest"

import {useAgentChatQueue, type ServerQueueAdapter} from "../../../src/hooks/useAgentChatQueue"

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

const assistantContinuation = (id: string, state: "running" | "done" | "error"): UIMessage =>
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
    continuationExecutionId?: string | null
    sessionId?: string
    server?: ServerQueueAdapter
}

const setup = (initial: HarnessProps) => {
    const sendQueued = vi.fn()
    const markRunOwned = vi.fn()
    const retryContinuation = vi.fn(() => Promise.resolve(true))
    const view = renderHook(
        (props: HarnessProps) =>
            useAgentChatQueue({...props, markRunOwned, sendQueued, retryContinuation}),
        {initialProps: initial},
    )
    return {markRunOwned, sendQueued, retryContinuation, ...view}
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

    it("hands the primary composer submit and explicit Steer to durable admission", async () => {
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: true,
            queued: [],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result, sendQueued} = setup({...settledEmpty, server})

        await act(async () => {
            result.current.submit({text: "wait next"})
            result.current.steer({text: "change direction"})
        })

        expect(server.submit).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({text: "wait next"}),
            "queue",
        )
        expect(server.submit).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({text: "change direction"}),
            "steer",
        )
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued).toHaveLength(0)
    })

    it("lets the server admit Queue-capable sends from a stale-idle snapshot", async () => {
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: false,
            queued: [],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result, sendQueued} = setup({...settledEmpty, server})

        await act(async () => {
            result.current.submit({text: "server decides"})
        })

        expect(server.submit).toHaveBeenCalledWith(
            expect.objectContaining({text: "server decides"}),
            "queue",
        )
        expect(sendQueued).not.toHaveBeenCalled()
    })

    it("never reports a failed durable admission as a client-only queued message", async () => {
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: true,
            queued: [],
            submit: vi.fn().mockRejectedValue(new Error("admission unavailable")),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result, sendQueued} = setup({...settledEmpty, server})

        await act(async () => {
            await expect(result.current.submit({text: "keep this draft"})).rejects.toThrow(
                "admission unavailable",
            )
        })

        expect(result.current.queued).toHaveLength(0)
        expect(sendQueued).not.toHaveBeenCalled()
    })

    it("propagates a refused Steer without inventing a client-only queued message", async () => {
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: true,
            queued: [],
            submit: vi.fn().mockRejectedValue(new Error("steer refused")),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result, sendQueued} = setup({...settledEmpty, server})

        await act(async () => {
            await expect(result.current.steer({text: "keep steering draft"})).rejects.toThrow(
                "steer refused",
            )
        })

        expect(result.current.queued).toHaveLength(0)
        expect(sendQueued).not.toHaveBeenCalled()
    })

    it("moves a client-held input behind the durable queue when its continuation starts", async () => {
        const durable = {
            id: "already-queued",
            text: "server first",
            source: "server" as const,
            editable: false,
        }
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: false,
            queued: [durable],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const paused: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
        }
        const {result, rerender, sendQueued} = setup(paused)

        await act(async () => {
            await result.current.submit({text: "held by this tab"})
        })
        expect(server.submit).not.toHaveBeenCalled()
        expect(result.current.queued).toEqual([expect.objectContaining({text: "held by this tab"})])

        await act(async () => {
            rerender({
                ...paused,
                server,
                continuationExecutionId: "a1-continuation-execution",
                messages: [userTurn("u1", "go"), assistantContinuation("a1", "running")],
            })
            await Promise.resolve()
        })

        expect(server.submit).toHaveBeenCalledOnce()
        expect(server.submit).toHaveBeenCalledWith(
            expect.objectContaining({text: "held by this tab"}),
            "queue",
        )
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued).toEqual([durable])
    })

    it("does not release an input locally while durable admission is still in flight", async () => {
        let acceptAdmission: (() => void) | undefined
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: false,
            queued: [],
            submit: vi.fn(
                () =>
                    new Promise<void>((resolve) => {
                        acceptAdmission = resolve
                    }),
            ),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const paused: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
            server,
        }
        const {result, rerender, sendQueued} = setup(paused)

        act(() => void result.current.submit({text: "held by this tab"}))
        rerender({
            ...paused,
            continuationExecutionId: "a1-continuation-execution",
            messages: [userTurn("u1", "go"), assistantContinuation("a1", "running")],
        })
        expect(server.submit).toHaveBeenCalledOnce()

        rerender({
            ...paused,
            continuationExecutionId: "a1-continuation-execution",
            messages: [userTurn("u1", "go"), assistantContinuation("a1", "done")],
        })
        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued).toHaveLength(0)

        await act(async () => {
            acceptAdmission?.()
            await Promise.resolve()
        })

        expect(sendQueued).not.toHaveBeenCalled()
        expect(result.current.queued).toHaveLength(0)
    })

    it("renders and removes server rows without releasing them through the local queue", () => {
        const durable = {
            id: "input-1",
            text: "shared",
            source: "server" as const,
            editable: false,
        }
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: false},
            busy: true,
            queued: [durable],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result, sendQueued} = setup({...settledEmpty, server})

        expect(result.current.queued).toEqual([durable])
        act(() => result.current.removeQueued("input-1"))

        expect(server.remove).toHaveBeenCalledWith("input-1")
        expect(sendQueued).not.toHaveBeenCalled()
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

    it("marks a released send as locally owned before dispatching it", () => {
        const paused: HarnessProps = {
            status: "ready",
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
        }
        const {result, rerender, markRunOwned, sendQueued} = setup(paused)
        act(() => result.current.submit({text: "held during the continuation"}))

        rerender({...paused, messages: [userTurn("u1", "go"), assistantText("a2", "done")]})

        expect(markRunOwned).toHaveBeenCalledOnce()
        expect(sendQueued).toHaveBeenCalledOnce()
        expect(markRunOwned.mock.invocationCallOrder[0]).toBeLessThan(
            sendQueued.mock.invocationCallOrder[0],
        )
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

describe("durable queued edits", () => {
    it("keeps the edit and draft until same-row persistence succeeds, including a retry", async () => {
        const edit = vi
            .fn()
            .mockRejectedValueOnce(new Error("conflict"))
            .mockResolvedValueOnce(undefined)
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: true,
            queued: [
                {id: "first", text: "first", source: "server"},
                {id: "selected", text: "old", source: "server"},
            ],
            submit: vi.fn(),
            remove: vi.fn(),
            edit,
        }
        const {result, sendQueued} = setup({...settledEmpty, server})
        act(() => result.current.beginEdit("selected", "original draft"))
        await act(async () => {
            await expect(result.current.commitEdit({text: "new"})).rejects.toThrow("conflict")
        })
        expect(result.current.editingId).toBe("selected")
        expect(result.current.queued.map((row) => row.id)).toEqual(["first", "selected"])
        let restored: string | undefined
        await act(async () => {
            restored = await result.current.commitEdit({text: "new"})
        })
        expect(restored).toBe("original draft")
        expect(result.current.editingId).toBeNull()
        expect(edit).toHaveBeenNthCalledWith(2, "selected", {text: "new"})
        expect(server.submit).not.toHaveBeenCalled()
        expect(server.remove).not.toHaveBeenCalled()
        expect(sendQueued).not.toHaveBeenCalled()
    })

    it("does not submit a new message if the durable row leaves the queue during editing", async () => {
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: true,
            queued: [{id: "selected", text: "old", source: "server"}],
            submit: vi.fn(),
            remove: vi.fn(),
            edit: vi.fn().mockRejectedValue(new Error("already promoted")),
        }
        const {result, rerender, sendQueued} = setup({...settledEmpty, server})
        act(() => result.current.beginEdit("selected", "draft"))
        rerender({...settledEmpty, server: {...server, queued: []}})
        await act(async () => {
            await expect(result.current.commitEdit({text: "new"})).rejects.toThrow(
                "already promoted",
            )
        })
        expect(result.current.editingId).toBe("selected")
        expect(server.submit).not.toHaveBeenCalled()
        expect(sendQueued).not.toHaveBeenCalled()
        let restored = ""
        act(() => {
            restored = result.current.cancelEdit()
        })
        expect(restored).toBe("draft")
    })
})

it.each([false, true])(
    "does not overwrite a newer edit when an older save settles (failure=%s)",
    async (failure) => {
        let resolve!: () => void
        let reject!: (error: Error) => void
        const edit = vi.fn(
            () =>
                new Promise<void>((yes, no) => {
                    resolve = yes
                    reject = no
                }),
        )
        const server: ServerQueueAdapter = {
            capabilities: {queue: true, steer: true},
            busy: true,
            queued: [
                {id: "first", text: "old", source: "server"},
                {id: "second", text: "other", source: "server"},
            ],
            submit: vi.fn(),
            remove: vi.fn(),
            edit,
        }
        const {result} = setup({...settledEmpty, server})
        act(() => result.current.beginEdit("first", "original draft"))
        let saving!: string | Promise<string>
        act(() => {
            saving = result.current.commitEdit({text: "changed"})
        })
        act(() => result.current.beginEdit("second", "new draft"))
        await act(async () => {
            if (failure) reject(new Error("old failure"))
            else resolve()
            expect(await saving).toBe("")
        })
        expect(result.current.editingId).toBe("second")
        let restored = ""
        act(() => {
            restored = result.current.cancelEdit()
        })
        expect(restored).toBe("new draft")
    },
)

describe("cold session capability admission", () => {
    it.each([true, false])(
        "waits for queue=%s before choosing the first send owner",
        async (queue) => {
            let resolve!: (value: {queue: boolean; steer: boolean}) => void
            const capability = new Promise<{queue: boolean; steer: boolean}>((done) => {
                resolve = done
            })
            const submitServer = vi.fn().mockResolvedValue(undefined)
            const server = {
                capabilities: {queue: false, steer: false},
                busy: false,
                queued: [],
                submit: submitServer,
                remove: vi.fn(),
                resolveCapabilities: () => capability,
            }
            const {result, sendQueued} = setup({...settledEmpty, server})
            const fileParts = [
                {
                    type: "file",
                    url: "https://qa.invalid/file",
                    mediaType: "text/plain",
                    filename: "notes.txt",
                },
            ] as FileUIPart[]
            let submission: unknown
            act(() => {
                submission = result.current.submit({text: "first", fileParts})
            })
            expect(sendQueued).not.toHaveBeenCalled()
            expect(submitServer).not.toHaveBeenCalled()
            await act(async () => {
                resolve({queue, steer: queue})
                await submission
            })
            if (queue) {
                expect(submitServer).toHaveBeenCalledWith(
                    expect.objectContaining({text: "first", fileParts}),
                    "queue",
                )
                expect(sendQueued).not.toHaveBeenCalled()
            } else {
                expect(sendQueued).toHaveBeenCalledWith(
                    expect.objectContaining({text: "first", fileParts}),
                )
                expect(submitServer).not.toHaveBeenCalled()
            }
        },
    )
    it("rejects unknown capability admission instead of falling back to native", async () => {
        const failure = new Error("Session is unavailable")
        const server = {
            capabilities: {queue: false, steer: false},
            busy: false,
            queued: [],
            submit: vi.fn(),
            remove: vi.fn(),
            resolveCapabilities: () => Promise.reject(failure),
        }
        const {result, sendQueued} = setup({...settledEmpty, server})
        await expect(result.current.submit({text: "keep this draft"})).rejects.toBe(failure)
        expect(sendQueued).not.toHaveBeenCalled()
        expect(server.submit).not.toHaveBeenCalled()
    })
})

it("keeps an edit and its displaced draft when a drained target cannot be readmitted", async () => {
    const server = {
        capabilities: {queue: false, steer: false},
        busy: false,
        queued: [],
        submit: vi.fn(),
        remove: vi.fn(),
        resolveCapabilities: vi.fn().mockRejectedValue(new Error("unavailable")),
    }
    const view = setup({status: "ready", messages: [], stopped: false, server})
    act(() => view.result.current.beginEdit("already-drained", "my displaced draft"))
    await act(async () => {
        await expect(view.result.current.commitEdit({text: "edited answer"})).rejects.toThrow(
            "unavailable",
        )
    })
    expect(view.result.current.editingId).toBe("already-drained")
    let restored: string | undefined
    act(() => {
        restored = view.result.current.cancelEdit()
    })
    expect(restored).toBe("my displaced draft")
    expect(view.sendQueued).not.toHaveBeenCalled()
})

it("uses current busy state when validated legacy capability arrives", async () => {
    let resolve!: (caps: {queue: boolean; steer: boolean}) => void
    const server = {
        capabilities: {queue: false, steer: false},
        busy: false,
        queued: [],
        submit: vi.fn(),
        remove: vi.fn(),
        resolveCapabilities: () =>
            new Promise<{queue: boolean; steer: boolean}>((done) => {
                resolve = done
            }),
    }
    const view = setup({status: "ready", messages: [], stopped: false, server})
    let pending: void | Promise<void>
    act(() => {
        pending = view.result.current.submit({text: "hold while starting"})
    })
    view.rerender({status: "streaming", messages: [], stopped: false, server})
    await act(async () => {
        resolve({queue: false, steer: false})
        await pending
    })
    expect(view.sendQueued).not.toHaveBeenCalled()
    expect(view.result.current.queued.map((message) => message.text)).toEqual([
        "hold while starting",
    ])
})

it("waits for cold Steer capabilities before admitting the explicit input", async () => {
    let resolve!: (capabilities: {queue: boolean; steer: boolean}) => void
    const server = {
        capabilities: {queue: false, steer: false},
        busy: true,
        queued: [],
        submit: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn(),
        resolveCapabilities: () =>
            new Promise<{queue: boolean; steer: boolean}>((done) => {
                resolve = done
            }),
    }
    const view = setup({status: "streaming", messages: [], stopped: false, server})
    let pending!: Promise<void>
    act(() => {
        pending = view.result.current.steer({text: "change direction"})
    })
    void pending.catch(() => undefined)
    expect(server.submit).not.toHaveBeenCalled()
    expect(resolve).toBeTypeOf("function")
    await act(async () => {
        resolve({queue: true, steer: true})
        await pending
    })
    expect(server.submit).toHaveBeenCalledWith(
        expect.objectContaining({text: "change direction"}),
        "steer",
    )
    expect(view.sendQueued).not.toHaveBeenCalled()
})

it("refuses cold Steer if the session settles while capabilities resolve", async () => {
    let resolve!: (capabilities: {queue: boolean; steer: boolean}) => void
    const server = {
        capabilities: {queue: false, steer: false},
        busy: true,
        queued: [],
        submit: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn(),
        resolveCapabilities: () =>
            new Promise<{queue: boolean; steer: boolean}>((done) => {
                resolve = done
            }),
    }
    const view = setup({status: "streaming", messages: [], stopped: false, server})
    let pending!: Promise<void>
    act(() => {
        pending = view.result.current.steer({text: "too late"})
    })
    void pending.catch(() => undefined)
    view.rerender({status: "ready", messages: [], stopped: false, server: {...server, busy: false}})
    await act(async () => {
        resolve({queue: true, steer: true})
        await expect(pending).rejects.toThrow("not ready")
    })
    expect(server.submit).not.toHaveBeenCalled()
    expect(view.sendQueued).not.toHaveBeenCalled()
})
