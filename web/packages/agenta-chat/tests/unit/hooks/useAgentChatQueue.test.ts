// @vitest-environment jsdom
import {act, renderHook, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {describe, expect, it, vi} from "vitest"

import {
    useAgentChatQueue,
    type QueuedMessage,
    type ServerQueueAdapter,
} from "../../../src/hooks/useAgentChatQueue"

// The pure predicates (`isHitlPending`, `approvalContinuationSettled`) are unit-tested in the
// playground package; these tests cover the HOOK's behavior on top of them: durable admission,
// Steer, the HITL and continuation signals, editing server-held rows, and the send echoes.

const userTurn = (id: string, text: string): UIMessage =>
    ({id, role: "user", parts: [{type: "text", text}]}) as UIMessage

/** An assistant tail paused on a parked client tool (a question form the dock owns). */
const assistantAwaitingQuestion = (id: string): UIMessage =>
    ({
        id,
        role: "assistant",
        parts: [
            {
                type: "tool-__ag__request_input",
                state: "input-available",
                toolCallId: `${id}-question`,
                input: {
                    message: "A few details",
                    requestedSchema: {type: "object", properties: {name: {type: "string"}}},
                },
            },
        ],
    }) as unknown as UIMessage

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

interface CapturedWatcher {
    onAccepted?: (executionId: string) => void
    onParked?: (inputId: string) => void
    onFailed?: () => void
    onSettled?: () => void
}

const durableServer = (
    admission: "running" | "queued" = "running",
): {server: ServerQueueAdapter; watchers: CapturedWatcher[]} => {
    const watchers: CapturedWatcher[] = []
    const server: ServerQueueAdapter = {
        busy: false,
        queued: [],
        submit: vi.fn(
            (_message: QueuedMessage, _policy: "queue" | "steer", watcher?: CapturedWatcher) => {
                if (watcher) watchers.push(watcher)
                return Promise.resolve(admission)
            },
        ),
        viewSeq: 0,
        remove: vi.fn().mockResolvedValue({outcome: "applied", settledSeq: 0}),
    }
    return {server, watchers}
}

interface HarnessProps {
    messages: UIMessage[]
    stopped: boolean
    continuationExecutionId?: string | null
    /** Defaults to a fresh `durableServer()` held for the whole mount. */
    server?: ServerQueueAdapter
    /**
     * Taken from the hook rather than restated, so the harness cannot drift from the seam it is
     * meant to exercise. It drifted once: the seam started accepting a host that answers later
     * than the call, and this stayed synchronous.
     */
    restoreRefusedSend?: Parameters<typeof useAgentChatQueue>[0]["restoreRefusedSend"]
    onSendAccepted?: Parameters<typeof useAgentChatQueue>[0]["onSendAccepted"]
    onSendFailed?: Parameters<typeof useAgentChatQueue>[0]["onSendFailed"]
}

const setup = (initial: HarnessProps) => {
    const fallback = durableServer().server
    const view = renderHook(
        ({server, ...props}: HarnessProps) =>
            useAgentChatQueue({...props, server: server ?? fallback}),
        {initialProps: initial},
    )
    return view
}

const settledEmpty: HarnessProps = {messages: [], stopped: false}

describe("useAgentChatQueue", () => {
    it("hands the primary composer submit and explicit Steer to durable admission", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result} = setup({...settledEmpty, server})

        await act(async () => {
            result.current.submit({text: "wait next"})
            result.current.steer({text: "change direction"})
        })

        expect(server.submit).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({text: "wait next"}),
            "queue",
            expect.anything(),
        )
        expect(server.submit).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({text: "change direction"}),
            "steer",
            expect.anything(),
        )
        // A busy-time queued send shows in the dock at once; the steer never does.
        expect(result.current.queued).toEqual([
            expect.objectContaining({text: "wait next", source: "local", editable: false}),
        ])
    })

    it("admits Steer while the run is parked on a client tool, before the snapshot says busy", async () => {
        // A question dismissed from the composer resumes the run server-side, but the parked run
        // reads `idle` and the next poll is seconds out. The transcript already says the turn is
        // parked on us, and the message steering in behind that dismiss rides on it.
        const server: ServerQueueAdapter = {
            busy: false,
            queued: [],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const idle = setup({...settledEmpty, server})
        await act(async () => {
            await expect(
                idle.result.current.steer({text: "nothing to steer into"}),
            ).rejects.toThrow("not ready to accept a Steer input")
        })

        const parked = setup({
            messages: [userTurn("u1", "go"), assistantAwaitingQuestion("a1")],
            stopped: false,
            server,
        })
        await act(async () => {
            await parked.result.current.steer({text: "answered in chat instead"})
        })

        expect(server.submit).toHaveBeenCalledWith(
            expect.objectContaining({text: "answered in chat instead"}),
            "steer",
            expect.anything(),
        )
    })

    it("refuses Steer while an APPROVAL is parked, so the message keeps queueing behind the gate", async () => {
        // A message typed over an approval is as likely to be consent as a redirect, so the gate
        // stays the only way to answer it. Reading "parked on the user" as steerable would have
        // admitted one straight past the queue.
        const server: ServerQueueAdapter = {
            busy: false,
            queued: [],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result} = setup({
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
            server,
        })

        await act(async () => {
            await expect(result.current.steer({text: "yes go ahead"})).rejects.toThrow(
                "not ready to accept a Steer input",
            )
        })
        expect(server.submit).not.toHaveBeenCalled()

        // The same message still queues, which is what the approval dock expects.
        await act(async () => {
            await result.current.submit({text: "yes go ahead"})
        })
        expect(server.submit).toHaveBeenCalledWith(
            expect.objectContaining({text: "yes go ahead"}),
            "queue",
            expect.anything(),
        )
    })

    it("lets the server admit a send from an idle snapshot", async () => {
        const server: ServerQueueAdapter = {
            busy: false,
            queued: [],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result} = setup({...settledEmpty, server})

        await act(async () => {
            result.current.submit({text: "server decides"})
        })

        expect(server.submit).toHaveBeenCalledWith(
            expect.objectContaining({text: "server decides"}),
            "queue",
            expect.anything(),
        )
    })

    it("never reports a failed durable admission as a client-only queued message", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [],
            submit: vi.fn().mockRejectedValue(new Error("admission unavailable")),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result} = setup({...settledEmpty, server})

        await act(async () => {
            await expect(result.current.submit({text: "keep this draft"})).rejects.toThrow(
                "admission unavailable",
            )
        })

        expect(result.current.queued).toHaveLength(0)
    })

    // A host that showed the session the moment the message left needs to hear about every way
    // that send can die (#6783 review): rejected before it left, or refused after the 200.
    it("reports a rejected durable send as failed, once", async () => {
        const onSendFailed = vi.fn()
        const onSendAccepted = vi.fn()
        const server: ServerQueueAdapter = {
            busy: false,
            queued: [],
            submit: vi.fn().mockRejectedValue(new Error("not ready")),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result} = setup({...settledEmpty, server, onSendFailed, onSendAccepted})

        await act(async () => {
            await expect(result.current.submit({text: "first message"})).rejects.toThrow(
                "not ready",
            )
        })

        expect(onSendFailed).toHaveBeenCalledOnce()
        expect(onSendFailed.mock.calls[0][0]).toMatchObject({text: "first message"})
        expect(onSendAccepted).not.toHaveBeenCalled()
    })

    it("reports a late refusal as failed and an admitted turn as accepted", async () => {
        const onSendFailed = vi.fn()
        const onSendAccepted = vi.fn()
        const server: ServerQueueAdapter = {
            busy: false,
            queued: [],
            submit: vi.fn(async (message, _policy, watcher) => {
                if (message.text === "refused") watcher?.onFailed?.()
                else watcher?.onAccepted?.("exec-1")
                return "running" as const
            }),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result} = setup({...settledEmpty, server, onSendFailed, onSendAccepted})

        await act(async () => {
            await result.current.submit({text: "refused"})
        })
        expect(onSendFailed).toHaveBeenCalledOnce()
        expect(onSendAccepted).not.toHaveBeenCalled()

        await act(async () => {
            await result.current.submit({text: "admitted"})
        })
        expect(onSendAccepted).toHaveBeenCalledOnce()
        expect(onSendAccepted.mock.calls[0][0]).toMatchObject({text: "admitted"})
        expect(onSendAccepted.mock.calls[0][1]).toBe("exec-1")
        expect(onSendFailed).toHaveBeenCalledOnce()
    })

    it("reports a parked send as admitted with no execution id", async () => {
        const onSendAccepted = vi.fn()
        const {server, watchers} = durableServer("queued")
        const {result} = setup({...settledEmpty, server, onSendAccepted})

        await act(async () => {
            await result.current.submit({text: "behind the turn"})
        })
        expect(onSendAccepted).not.toHaveBeenCalled()

        await act(async () => watchers[0].onParked?.("input-1"))
        expect(onSendAccepted).toHaveBeenCalledOnce()
        expect(onSendAccepted.mock.calls[0][0]).toMatchObject({text: "behind the turn"})
        expect(onSendAccepted.mock.calls[0][1]).toBeNull()
    })

    it("propagates a refused Steer without inventing a client-only queued message", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [],
            submit: vi.fn().mockRejectedValue(new Error("steer refused")),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result} = setup({...settledEmpty, server})

        await act(async () => {
            await expect(result.current.steer({text: "keep steering draft"})).rejects.toThrow(
                "steer refused",
            )
        })

        expect(result.current.queued).toHaveLength(0)
    })

    it("refuses Steer when the server has no running turn to steer", async () => {
        const {server} = durableServer()
        const {result} = setup({...settledEmpty, server})

        await act(async () => {
            await expect(result.current.steer({text: "too late"})).rejects.toThrow("not ready")
        })

        expect(server.submit).not.toHaveBeenCalled()
    })

    it("hides a removed row at once and keeps it hidden until a later read drops it", async () => {
        const durable = {
            id: "input-1",
            text: "shared",
            source: "server" as const,
            editable: false,
        }
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [durable],
            viewSeq: 1,
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue({outcome: "applied", settledSeq: 1}),
        }
        const {result, rerender} = setup({...settledEmpty, server})

        expect(result.current.queued).toEqual([durable])
        act(() => result.current.removeQueued("not-held"))
        expect(server.remove).not.toHaveBeenCalled()

        await act(async () => result.current.removeQueued("input-1"))
        expect(server.remove).toHaveBeenCalledWith("input-1")
        expect(result.current.queued).toEqual([])
        // A read that began before the removal still lists the row; it stays hidden.
        rerender({...settledEmpty, server: {...server, viewSeq: 1}})
        expect(result.current.queued).toEqual([])
        rerender({...settledEmpty, server: {...server, queued: [], viewSeq: 2}})
        expect(result.current.queued).toEqual([])
        expect(server.submit).not.toHaveBeenCalled()
    })

    it.each([
        ["failed", "Couldn't remove this message. Try again."],
        ["conflict", "This message already started."],
    ] as const)("puts a row whose removal was %s back, with its error", async (outcome, error) => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "input-1", text: "shared", source: "server"}],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn().mockResolvedValue({outcome, settledSeq: 1}),
        }
        const {result} = setup({...settledEmpty, server})
        act(() => result.current.removeQueued("input-1"))
        await waitFor(() =>
            expect(result.current.queued).toEqual([
                expect.objectContaining({id: "input-1", text: "shared", error}),
            ]),
        )
    })

    it("removes a just-sent row once the server names the input it became", async () => {
        const {server, watchers} = durableServer("queued")
        const busy = {...server, busy: true}
        const {result} = setup({...settledEmpty, server: busy})
        await act(async () => {
            await result.current.submit({text: "never mind"})
        })
        const [row] = result.current.queued
        expect(row).toMatchObject({text: "never mind", source: "local", removable: true})

        act(() => result.current.removeQueued(row.id))
        expect(result.current.queued).toEqual([])
        expect(busy.remove).not.toHaveBeenCalled()

        act(() => watchers[0].onParked?.("input-9"))
        expect(busy.remove).toHaveBeenCalledWith("input-9")
        expect(result.current.queued).toEqual([])
        expect(result.current.pendingSendRows).toEqual([])
    })

    it("moves a Send Now row into the transcript at once, and back with an error on failure", async () => {
        let finish!: (result: {
            outcome: "applied" | "failed"
            settledSeq: number
            executionId: string | null
        }) => void
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "input-1", text: "do this first", source: "server"}],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn(),
            sendNow: vi.fn(() => new Promise((resolve) => (finish = resolve))),
        }
        const {result} = setup({...settledEmpty, server})
        act(() => result.current.sendQueuedNow?.("input-1"))
        expect(server.sendNow).toHaveBeenCalledWith("input-1")
        expect(result.current.queued).toEqual([])
        expect(echoText(result)).toEqual(["do this first"])

        act(() => finish({outcome: "failed", settledSeq: 1, executionId: null}))
        await waitFor(() =>
            expect(result.current.queued).toEqual([
                expect.objectContaining({
                    id: "input-1",
                    error: "Couldn't send this message now. Try again.",
                }),
            ]),
        )
        expect(echoText(result)).toEqual([])
    })

    it("reports hitlPending while a HITL approval is pending, and still admits through the server", async () => {
        const {server} = durableServer()
        const {result} = setup({
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
            server,
        })
        expect(result.current.hitlPending).toBe(true)

        await act(async () => {
            await result.current.submit({text: "while paused"})
        })

        expect(server.submit).toHaveBeenCalledWith(
            expect.objectContaining({text: "while paused"}),
            "queue",
            expect.anything(),
        )
    })

    it("a user stop voids hitlPending", () => {
        const {result} = setup({
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: true,
        })
        expect(result.current.hitlPending).toBe(false)
    })

    it("owns the continuation it started until that execution's terminal record lands", () => {
        const running: HarnessProps = {
            messages: [userTurn("u1", "go"), assistantContinuation("a1", "running")],
            stopped: false,
            continuationExecutionId: "a1-continuation-execution",
        }
        const {result, rerender} = setup(running)
        expect(result.current.ownsContinuation).toBe(true)

        const observer = setup({...running, continuationExecutionId: null})
        expect(observer.result.current.ownsContinuation).toBe(false)

        rerender({
            ...running,
            messages: [userTurn("u1", "go"), assistantContinuation("a1", "done")],
        })
        expect(result.current.ownsContinuation).toBe(false)
    })

    it("hands the stashed composer draft back when an edit is cancelled", () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "one", text: "one", source: "server"}],
            submit: vi.fn(),
            remove: vi.fn(),
            edit: vi.fn(),
        }
        const {result} = setup({...settledEmpty, server})
        act(() => {
            result.current.beginEdit("one", "half-typed draft")
        })
        expect(result.current.editingId).toBe("one")
        let restored = ""
        act(() => {
            restored = result.current.cancelEdit()
        })
        expect(restored).toBe("half-typed draft")
        expect(result.current.editingId).toBeNull()
        expect(result.current.queued.map((m) => m.text)).toEqual(["one"])
        expect(server.edit).not.toHaveBeenCalled()
    })

    it("hands the stashed draft back on commit too, and only once", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "one", text: "one", source: "server"}],
            submit: vi.fn(),
            remove: vi.fn(),
            edit: vi.fn().mockResolvedValue({outcome: "applied", settledSeq: 0}),
        }
        const {result} = setup({...settledEmpty, server})
        act(() => {
            result.current.beginEdit("one", "half-typed draft")
        })
        let restored = ""
        await act(async () => {
            restored = await result.current.commitEdit({text: "one, rewritten"})
        })
        // Committing consumes the composer, so the displaced draft must come back here as well —
        // otherwise typing then editing silently destroys what was typed.
        expect(restored).toBe("half-typed draft")
        expect(server.edit).toHaveBeenCalledWith("one", {text: "one, rewritten"})
        expect(result.current.editingId).toBeNull()
        // A second session with no draft must not resurrect the old one.
        act(() => {
            result.current.beginEdit("one")
        })
        let second = "unset"
        act(() => {
            second = result.current.cancelEdit()
        })
        expect(second).toBe("")
    })

    it("submits a new message when the edited target is no longer server-held", async () => {
        const {server} = durableServer()
        const {result} = setup({...settledEmpty, server: {...server, edit: vi.fn()}})
        act(() => {
            result.current.beginEdit("already-drained", "my displaced draft")
        })
        let restored = ""
        await act(async () => {
            restored = await result.current.commitEdit({text: "one, but better"})
        })
        // Nothing was left to rewrite, so the content becomes a message of its own rather than
        // disappearing.
        expect(server.submit).toHaveBeenCalledWith(
            expect.objectContaining({text: "one, but better"}),
            "queue",
            expect.anything(),
        )
        expect(restored).toBe("my displaced draft")
        expect(result.current.editingId).toBeNull()
    })

    it("keeps an edit and its displaced draft when a drained target cannot be readmitted", async () => {
        const server: ServerQueueAdapter = {
            busy: false,
            queued: [],
            submit: vi.fn().mockRejectedValue(new Error("unavailable")),
            remove: vi.fn(),
            edit: vi.fn(),
        }
        const {result} = setup({...settledEmpty, server})
        act(() => result.current.beginEdit("already-drained", "my displaced draft"))
        await act(async () => {
            await expect(result.current.commitEdit({text: "edited answer"})).rejects.toThrow(
                "unavailable",
            )
        })
        expect(result.current.editingId).toBe("already-drained")
        expect(server.edit).not.toHaveBeenCalled()
        let restored: string | undefined
        act(() => {
            restored = result.current.cancelEdit()
        })
        expect(restored).toBe("my displaced draft")
    })
})

describe("Send Now over a stop that is still pending", () => {
    it("says another message goes first when the server refuses a second Send Now", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "input-2", text: "second", source: "server"}],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn(),
            sendNow: vi
                .fn()
                .mockResolvedValue({outcome: "busy", settledSeq: 1, executionId: null}),
        }
        const {result} = setup({...settledEmpty, server})
        act(() => result.current.sendQueuedNow?.("input-2"))
        await waitFor(() =>
            expect(result.current.queued).toEqual([
                expect.objectContaining({
                    id: "input-2",
                    error: "Another message is being sent first. Try again once it starts.",
                }),
            ]),
        )
    })

    it("reports a pending Send Now until the server stops listing it, from any tab", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [
                {id: "input-1", text: "first", source: "server"},
                {id: "input-2", text: "second", source: "server"},
            ],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn(),
            sendNow: vi
                .fn()
                .mockResolvedValue({outcome: "applied", settledSeq: 1, executionId: null}),
        }
        const {result, rerender} = setup({...settledEmpty, server})
        expect(result.current.sendNowPending).toBe(false)
        act(() => result.current.sendQueuedNow?.("input-1"))
        expect(result.current.sendNowPending).toBe(true)
        // The server re-lists it as the steer the stop carries: still hidden, still pending.
        const steered = {
            ...server,
            queued: [{...server.queued[0], policy: "steer" as const}, server.queued[1]],
            viewSeq: 3,
        }
        rerender({...settledEmpty, server: steered})
        expect(result.current.queued.map((row) => row.id)).toEqual(["input-2"])
        expect(result.current.sendNowPending).toBe(true)
        rerender({...settledEmpty, server: {...server, queued: [server.queued[1]], viewSeq: 4}})
        await waitFor(() => expect(result.current.sendNowPending).toBe(false))
    })

    it("withdraws the pending input on Stop and hands its text back", async () => {
        const restoreRefusedSend = vi.fn().mockResolvedValue(true)
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "input-1", text: "run me next", source: "server", policy: "steer"}],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn().mockResolvedValue({outcome: "applied", settledSeq: 1}),
        }
        const {result} = setup({...settledEmpty, server, restoreRefusedSend})
        expect(result.current.sendNowPending).toBe(true)
        act(() => result.current.cancelPendingSendNow())
        expect(server.remove).toHaveBeenCalledWith("input-1")
        await waitFor(() =>
            expect(restoreRefusedSend).toHaveBeenCalledWith(
                expect.objectContaining({text: "run me next"}),
            ),
        )
        expect(echoText(result)).toEqual([])
    })
})

describe("a steer the transcript took over", () => {
    it("stays out of the dock until a later read, and comes back if that read still lists it", async () => {
        const {server, watchers} = durableServer("queued")
        const busy = {...server, busy: true}
        const {result, rerender} = setup({...settledEmpty, server: busy})
        await act(async () => {
            await result.current.steer({text: "skip that"})
        })
        act(() => watchers[0].onParked?.("input-1"))
        const row: QueuedMessage = {id: "input-1", text: "skip that", source: "server", policy: "steer"}
        const listing = {...busy, queued: [row], viewSeq: 1}
        rerender({...settledEmpty, server: listing})
        // The echo covers it while it is the only copy on screen.
        expect(result.current.queued).toEqual([])
        // Its saved row lands; the snapshot is a poll behind and still lists it.
        rerender({...settledEmpty, messages: [userTurn("u1", "skip that")], server: listing})
        expect(result.current.queued).toEqual([])
        // A read after the hand-over still lists it: the turn never consumed it, so it shows.
        rerender({
            ...settledEmpty,
            messages: [userTurn("u1", "skip that")],
            server: {...listing, queued: [row], viewSeq: 3},
        })
        await waitFor(() => expect(result.current.queued.map((item) => item.id)).toEqual(["input-1"]))
    })
})

describe("a queued input that starts on its own", () => {
    const row: QueuedMessage = {id: "input-1", text: "next", source: "server"}
    const server = (queued: QueuedMessage[], viewSeq: number): ServerQueueAdapter => ({
        busy: true,
        queued,
        viewSeq,
        submit: vi.fn(),
        remove: vi.fn(),
    })

    it("is not held back in the dock when its user row landed before the listing dropped", () => {
        const {result, rerender} = setup({...settledEmpty, server: server([row], 1)})
        const listing = server([row], 1)
        rerender({...settledEmpty, server: listing})
        rerender({...settledEmpty, messages: [userTurn("u1", "next")], server: listing})
        rerender({...settledEmpty, messages: [userTurn("u1", "next")], server: server([], 2)})
        expect(result.current.queued).toEqual([])
    })

    it("is held until its user row lands when the listing drops first", () => {
        const {result, rerender} = setup({...settledEmpty, server: server([row], 1)})
        rerender({...settledEmpty, server: server([], 2)})
        expect(result.current.queued).toEqual([expect.objectContaining({id: "input-1"})])
        rerender({...settledEmpty, messages: [userTurn("u1", "next")], server: server([], 2)})
        expect(result.current.queued).toEqual([])
    })
})

describe("promoted inputs", () => {
    it("leaves the dock once the transcript holds the turn it started", () => {
        const promoted: QueuedMessage = {
            id: "input-1",
            text: "skip that, say ok",
            source: "server",
            policy: "steer",
            removable: false,
            promotedExecutionId: "turn-2",
        }
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [promoted],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn(),
        }
        const {result, rerender} = setup({...settledEmpty, server})
        // Starting but not yet saved: a recoverable promotion must stay visible.
        expect(result.current.queued.map((row) => row.id)).toEqual(["input-1"])
        const saved = {
            ...userTurn("u2", "skip that, say ok"),
            metadata: {turnId: "turn-2"},
        } as UIMessage
        rerender({...settledEmpty, messages: [saved], server})
        expect(result.current.queued).toEqual([])
    })
})

describe("durable queued edits", () => {
    it("shows the new text and closes at once; a failure keeps the edit on the row", async () => {
        let finish!: (result: {outcome: "applied" | "failed"; settledSeq: number}) => void
        const edit = vi.fn(() => new Promise((resolve) => (finish = resolve)))
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [
                {id: "first", text: "first", source: "server"},
                {id: "selected", text: "old", source: "server"},
            ],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn(),
            edit,
        }
        const {result} = setup({...settledEmpty, server})
        act(() => result.current.beginEdit("selected", "original draft"))
        let restored: string | undefined
        await act(async () => {
            restored = await result.current.commitEdit({text: "new"})
        })
        expect(restored).toBe("original draft")
        expect(result.current.editingId).toBeNull()
        expect(result.current.queued.map((row) => row.text)).toEqual(["first", "new"])

        act(() => finish({outcome: "failed", settledSeq: 1}))
        await waitFor(() =>
            expect(result.current.queued[1]).toMatchObject({
                text: "old",
                error: "Your edit wasn't saved. Edit to try again.",
                unsavedEdit: {text: "new"},
            }),
        )
        expect(server.submit).not.toHaveBeenCalled()
        expect(server.remove).not.toHaveBeenCalled()

        // Editing again clears the error and retries the same row.
        act(() => result.current.beginEdit("selected"))
        expect(result.current.queued[1].error).toBeUndefined()
        await act(async () => {
            await result.current.commitEdit({text: "new"})
        })
        expect(edit).toHaveBeenNthCalledWith(2, "selected", {text: "new"})
    })

    it("keeps the edit as a flagged row when the queued row left before it saved", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "selected", text: "old", source: "server"}],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn(),
            edit: vi.fn().mockResolvedValue({outcome: "conflict", settledSeq: 1}),
        }
        const {result, rerender} = setup({...settledEmpty, server})
        act(() => result.current.beginEdit("selected", "draft"))
        rerender({...settledEmpty, server: {...server, queued: []}})
        let restored = ""
        await act(async () => {
            restored = await result.current.commitEdit({text: "new"})
        })
        expect(restored).toBe("draft")
        // Never a second send: the text waits where the user can see and resend it.
        expect(server.submit).not.toHaveBeenCalled()
        await waitFor(() => expect(echoText(result)).toEqual(["new"]))
    })

    it("hands a refused edit to the composer when it can take it", async () => {
        const restoreRefusedSend = vi.fn().mockResolvedValue(true)
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "selected", text: "old", source: "server"}],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn(),
            edit: vi.fn().mockResolvedValue({outcome: "not_found", settledSeq: 1}),
        }
        const {result} = setup({...settledEmpty, server, restoreRefusedSend})
        act(() => result.current.beginEdit("selected"))
        await act(async () => {
            await result.current.commitEdit({text: "new"})
        })
        await waitFor(() =>
            expect(restoreRefusedSend).toHaveBeenCalledWith(expect.objectContaining({text: "new"})),
        )
        expect(echoText(result)).toEqual([])
    })
})

it.each([false, true])(
    "does not overwrite a newer edit when an older save settles (failure=%s)",
    async (failure) => {
        let finish!: (result: {outcome: "applied" | "failed"; settledSeq: number}) => void
        const edit = vi.fn(() => new Promise((resolve) => (finish = resolve)))
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [
                {id: "first", text: "old", source: "server"},
                {id: "second", text: "other", source: "server"},
            ],
            viewSeq: 1,
            submit: vi.fn(),
            remove: vi.fn(),
            edit,
        }
        const {result} = setup({...settledEmpty, server})
        act(() => result.current.beginEdit("first", "original draft"))
        let saving!: Promise<string>
        act(() => {
            saving = result.current.commitEdit({text: "changed"})
        })
        expect(await saving).toBe("original draft")
        act(() => result.current.beginEdit("second", "new draft"))
        await act(async () => finish({outcome: failure ? "failed" : "applied", settledSeq: 1}))
        await waitFor(() => expect(edit).toHaveBeenCalledOnce())
        expect(result.current.editingId).toBe("second")
        let restored = ""
        act(() => {
            restored = result.current.cancelEdit()
        })
        expect(restored).toBe("new draft")
    },
)

// ── Wiring the echo of a durable send ─────────────────────────────────────────────────────────
// Reconciliation itself lives in usePendingSendEchoes and is tested there. These cover only what
// this hook is responsible for: showing the send at once, and routing each server outcome to it.

const echoText = (result: {current: {pendingSendRows: UIMessage[]}}) =>
    result.current.pendingSendRows.map((row) =>
        row.parts.map((part) => ("text" in part ? part.text : "")).join(""),
    )

describe("useAgentChatQueue durable send echoes", () => {
    it("keeps a steer as a transcript echo, never a dock row", async () => {
        // A steer is on its way INTO the running turn. Read as a held message it would flash up
        // in the queue dock ("waits for your answer") between the 202 and the turn saving it as a
        // user row — the very seam the dismiss-then-steer over a parked question sits on.
        const {server, watchers} = durableServer("queued")
        server.busy = true
        const parked: HarnessProps = {
            messages: [userTurn("u1", "go")],
            stopped: false,
            server,
        }
        const {result, rerender} = setup(parked)

        await act(async () => {
            await result.current.steer({text: "answered in chat instead"})
        })
        expect(echoText(result)).toEqual(["answered in chat instead"])

        act(() => watchers[0].onParked?.("input-steer"))
        const steered: QueuedMessage = {
            id: "input-steer",
            text: "answered in chat instead",
            policy: "steer",
            source: "server",
            editable: false,
        }
        rerender({...parked, server: {...server, queued: [steered]}})

        expect(result.current.queued).toEqual([])
        expect(echoText(result)).toEqual(["answered in chat instead"])

        // The run saved it: the real user row retires the echo.
        rerender({
            ...parked,
            messages: [userTurn("u1", "go"), userTurn("u2", "answered in chat instead")],
            server: {...server, queued: []},
        })
        expect(echoText(result)).toEqual([])
    })

    it("shows a parked steer in the dock again once its echo stops covering it", async () => {
        // The turn ended without consuming the input. Hidden forever, the message would be
        // unreachable — no row to remove, send now, or even see.
        const {server, watchers} = durableServer("queued")
        server.busy = true
        const parked: HarnessProps = {
            messages: [userTurn("u1", "go")],
            stopped: false,
            server,
        }
        const {result, rerender} = setup(parked)

        await act(async () => {
            await result.current.steer({text: "answered in chat instead"})
        })
        act(() => watchers[0].onParked?.("input-steer"))
        const steered: QueuedMessage = {
            id: "input-steer",
            text: "answered in chat instead",
            policy: "steer",
            source: "server",
            editable: false,
        }
        const withRow = {...parked, server: {...server, queued: [steered]}}
        rerender(withRow)
        expect(result.current.queued).toEqual([])

        act(() => watchers[0].onSettled?.())
        rerender({...withRow, server: {...server, queued: [steered]}})

        expect(result.current.queued).toEqual([steered])
    })

    it("shows a durable send before the request resolves", async () => {
        let admit!: (value: "running") => void
        const {server} = durableServer()
        server.submit = vi.fn(() => new Promise<"running">((resolve) => (admit = resolve)))
        const {result} = setup({...settledEmpty, server})

        act(() => {
            void result.current.submit({text: "show me now"})
        })

        expect(echoText(result)).toEqual(["show me now"])
        expect(result.current.pendingSendRows[0].role).toBe("user")
        await act(async () => admit("running"))
        expect(echoText(result)).toEqual(["show me now"])
    })

    it("retires it when the transcript adopts the turn the server named", async () => {
        const {server, watchers} = durableServer()
        const props: HarnessProps = {...settledEmpty, server}
        const {result, rerender} = setup(props)

        await act(async () => {
            await result.current.submit({text: "saved soon"})
        })
        await act(async () => watchers[0].onAccepted?.("turn-1"))
        expect(echoText(result)).toEqual(["saved soon"])

        rerender({
            ...props,
            messages: [
                {
                    id: "record-1",
                    role: "user",
                    parts: [{type: "text", text: "saved soon"}],
                    metadata: {turnId: "turn-1"},
                } as unknown as UIMessage,
            ],
        })
        expect(result.current.pendingSendRows).toHaveLength(0)
    })

    it("keeps a parked send until the dock actually lists its durable input", async () => {
        const {server, watchers} = durableServer("queued")
        const props: HarnessProps = {
            ...settledEmpty,
            messages: [userTurn("u1", "go")],
            server,
        }
        const {result, rerender} = setup(props)

        await act(async () => {
            await result.current.submit({text: "behind the turn"})
        })
        await act(async () => watchers[0].onParked?.("input-1"))
        expect(echoText(result)).toEqual(["behind the turn"])

        rerender({
            ...props,
            server: {
                ...server,
                queued: [{id: "input-1", text: "behind the turn", source: "server"}],
            },
        })
        expect(result.current.pendingSendRows).toHaveLength(0)
    })

    it("keeps the row, flagged, when the run stream reports a failure", async () => {
        // The composer cleared on submit, so deleting the row here would lose the user's text.
        const {server, watchers} = durableServer()
        const {result} = setup({...settledEmpty, server})

        await act(async () => {
            await result.current.submit({text: "refused late"})
        })
        expect(echoText(result)).toEqual(["refused late"])

        await act(async () => watchers[0].onFailed?.())
        expect(echoText(result)).toEqual(["refused late"])
        expect(result.current.pendingSendRows[0].metadata).toMatchObject({pendingSendFailed: true})
    })

    it("drops it when the send is refused, so the composer restore is not doubled", async () => {
        const {server} = durableServer()
        server.submit = vi.fn().mockRejectedValue(new Error("The input was not accepted (409)."))
        const {result} = setup({...settledEmpty, server})

        await act(async () => {
            await expect(result.current.submit({text: "refused"})).rejects.toThrow(
                "The input was not accepted (409).",
            )
        })

        expect(result.current.pendingSendRows).toHaveLength(0)
    })
})

describe("useAgentChatQueue echo settlement", () => {
    it("stops waiting silently when the turn ends without saving the message", async () => {
        const {server, watchers} = durableServer()
        const {result} = setup({...settledEmpty, server})

        await act(async () => {
            await result.current.submit({text: "never persisted"})
        })
        await act(async () => watchers[0].onAccepted?.("turn-1"))
        expect(result.current.pendingSendRows[0].metadata).not.toMatchObject({
            pendingSendFailed: true,
        })

        await act(async () => watchers[0].onSettled?.())
        expect(echoText(result)).toEqual(["never persisted"])
        expect(result.current.pendingSendRows[0].metadata).toMatchObject({pendingSendFailed: true})
    })

    it("retires normally when the row lands after the turn settles", async () => {
        const {server, watchers} = durableServer()
        const props: HarnessProps = {...settledEmpty, server}
        const {result, rerender} = setup(props)

        await act(async () => {
            await result.current.submit({text: "late row"})
        })
        await act(async () => watchers[0].onAccepted?.("turn-1"))
        await act(async () => watchers[0].onSettled?.())

        rerender({
            ...props,
            messages: [
                {
                    id: "record-1",
                    role: "user",
                    parts: [{type: "text", text: "late row"}],
                    metadata: {turnId: "turn-1"},
                } as unknown as UIMessage,
            ],
        })
        expect(result.current.pendingSendRows).toHaveLength(0)
    })
})

describe("useAgentChatQueue late refusal recovery", () => {
    it("hands the text back to the composer and drops the row", async () => {
        // One event, one recovery: a refusal after the promise resolved lands in the composer
        // exactly like one that rejected it.
        const {server, watchers} = durableServer()
        const restoreRefusedSend = vi.fn(() => true)
        const {result} = setup({...settledEmpty, server, restoreRefusedSend})

        await act(async () => {
            await result.current.submit({text: "refused late"})
        })
        await act(async () => watchers[0].onFailed?.())

        expect(restoreRefusedSend).toHaveBeenCalledWith(
            expect.objectContaining({text: "refused late"}),
        )
        expect(result.current.pendingSendRows).toHaveLength(0)
    })

    it("keeps the flagged row when no composer can take the text", async () => {
        const {server, watchers} = durableServer()
        const restoreRefusedSend = vi.fn(() => false)
        const {result} = setup({...settledEmpty, server, restoreRefusedSend})

        await act(async () => {
            await result.current.submit({text: "nowhere to go"})
        })
        await act(async () => watchers[0].onFailed?.())

        expect(echoText(result)).toEqual(["nowhere to go"])
        expect(result.current.pendingSendRows[0].metadata).toMatchObject({pendingSendFailed: true})
    })
})

describe("useAgentChatQueue late refusal recovery, asynchronous composer", () => {
    // The live defect on staging at 66ed5a6c57: on /w, a refusal arriving as a 200 whose stream
    // errors left the message in BOTH places, a flagged row AND the text in the composer, so it
    // could be sent twice. The restorer places the text into Lexical, which commits on a later
    // tick, so a restorer that can only answer on the next tick was read as a refusal to take it.
    it("drops the row once a composer that answers LATE confirms it took the text", async () => {
        const {server, watchers} = durableServer()
        let settle: ((took: boolean) => void) | undefined
        const restoreRefusedSend = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    settle = resolve
                }),
        )
        const {result} = setup({...settledEmpty, server, restoreRefusedSend})

        await act(async () => {
            await result.current.submit({text: "refused late"})
        })
        await act(async () => watchers[0].onFailed?.())

        // The row is up while the composer has not answered: the message must never be in
        // NEITHER place, so the row is the safe side to fail to.
        expect(echoText(result)).toEqual(["refused late"])
        expect(result.current.pendingSendRows[0].metadata).toMatchObject({pendingSendFailed: true})

        await act(async () => {
            settle!(true)
            await Promise.resolve()
        })

        // ...and it comes down once the composer confirms, so the message ends in exactly one.
        expect(result.current.pendingSendRows).toHaveLength(0)
    })

    it("keeps the row when a composer that answers LATE says it could not take the text", async () => {
        const {server, watchers} = durableServer()
        let settle: ((took: boolean) => void) | undefined
        const restoreRefusedSend = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    settle = resolve
                }),
        )
        const {result} = setup({...settledEmpty, server, restoreRefusedSend})

        await act(async () => {
            await result.current.submit({text: "nowhere to go"})
        })
        await act(async () => watchers[0].onFailed?.())
        await act(async () => {
            settle!(false)
            await Promise.resolve()
        })

        expect(echoText(result)).toEqual(["nowhere to go"])
        expect(result.current.pendingSendRows[0].metadata).toMatchObject({pendingSendFailed: true})
    })

    it("still drops the row for a composer that answers immediately", async () => {
        // Both hosts' restorers may report synchronously; that path must not regress.
        const {server, watchers} = durableServer()
        const restoreRefusedSend = vi.fn(() => true)
        const {result} = setup({...settledEmpty, server, restoreRefusedSend})

        await act(async () => {
            await result.current.submit({text: "taken at once"})
        })
        await act(async () => {
            watchers[0].onFailed?.()
            await Promise.resolve()
        })

        expect(result.current.pendingSendRows).toHaveLength(0)
    })
})

describe("useAgentChatQueue settlement never touches the composer", () => {
    it("does not restore a delivered message when its echo has already retired", async () => {
        // The normal accepted path: row adopted, echo retired, stream ends. Restoring here wrote
        // a delivered and answered message back into the input under "wasn't sent".
        const {server, watchers} = durableServer()
        const restoreRefusedSend = vi.fn(() => true)
        const props: HarnessProps = {...settledEmpty, server, restoreRefusedSend}
        const {result, rerender} = setup(props)

        await act(async () => {
            await result.current.submit({text: "delivered"})
        })
        await act(async () => watchers[0].onAccepted?.("turn-1"))

        rerender({
            ...props,
            messages: [
                {
                    id: "record-1",
                    role: "user",
                    parts: [{type: "text", text: "delivered"}],
                    metadata: {turnId: "turn-1"},
                } as unknown as UIMessage,
            ],
        })
        expect(result.current.pendingSendRows).toHaveLength(0)

        await act(async () => watchers[0].onSettled?.())

        expect(restoreRefusedSend).not.toHaveBeenCalled()
        expect(result.current.pendingSendRows).toHaveLength(0)
    })

    it("still flags an echo that is genuinely still waiting when its turn settles", async () => {
        const {server, watchers} = durableServer()
        const restoreRefusedSend = vi.fn(() => true)
        const {result} = setup({...settledEmpty, server, restoreRefusedSend})

        await act(async () => {
            await result.current.submit({text: "never persisted"})
        })
        await act(async () => watchers[0].onAccepted?.("turn-1"))
        await act(async () => watchers[0].onSettled?.())

        expect(restoreRefusedSend).not.toHaveBeenCalled()
        expect(result.current.pendingSendRows[0].metadata).toMatchObject({pendingSendFailed: true})
    })
})

describe("useAgentChatQueue refusal after the echo has gone", () => {
    it("re-creates the row when the count retired it and the composer declines", async () => {
        // The pre-acknowledgement window can retire an echo before its refusal arrives. If the
        // composer also declines, because the user has typed since, the message previously had
        // neither a row nor a restored draft: it was gone.
        const {server, watchers} = durableServer()
        const restoreRefusedSend = vi.fn(() => false)
        const props: HarnessProps = {...settledEmpty, server, restoreRefusedSend}
        const {result, rerender} = setup(props)

        await act(async () => {
            await result.current.submit({text: "refused after retirement"})
        })

        // A foreign row retires it on the count before any identity arrives.
        rerender({...props, messages: [userTurn("foreign-1", "someone else")]})
        expect(result.current.pendingSendRows).toHaveLength(0)

        await act(async () => watchers[0].onFailed?.())

        expect(echoText(result)).toEqual(["refused after retirement"])
        expect(result.current.pendingSendRows[0].metadata).toMatchObject({pendingSendFailed: true})
    })

    it("does not re-create a row when the composer took the text", async () => {
        const {server, watchers} = durableServer()
        const restoreRefusedSend = vi.fn(() => true)
        const props: HarnessProps = {...settledEmpty, server, restoreRefusedSend}
        const {result, rerender} = setup(props)

        await act(async () => {
            await result.current.submit({text: "restored instead"})
        })
        rerender({...props, messages: [userTurn("foreign-1", "someone else")]})

        await act(async () => watchers[0].onFailed?.())

        expect(result.current.pendingSendRows).toHaveLength(0)
    })
})
