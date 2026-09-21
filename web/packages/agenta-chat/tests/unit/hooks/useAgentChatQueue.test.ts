// @vitest-environment jsdom
import {act, renderHook} from "@testing-library/react"
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
        remove: vi.fn().mockResolvedValue(undefined),
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
        )
        expect(result.current.queued).toHaveLength(0)
    })

    it("admits Steer while the run is parked on the user, before the snapshot says busy", async () => {
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
            messages: [userTurn("u1", "go"), assistantAwaitingApproval("a1")],
            stopped: false,
            server,
        })
        await act(async () => {
            await parked.result.current.steer({text: "answered in chat instead"})
        })

        expect(server.submit).toHaveBeenCalledWith(
            expect.objectContaining({text: "answered in chat instead"}),
            "steer",
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

    it("renders and removes server rows", () => {
        const durable = {
            id: "input-1",
            text: "shared",
            source: "server" as const,
            editable: false,
        }
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [durable],
            submit: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        }
        const {result} = setup({...settledEmpty, server})

        expect(result.current.queued).toEqual([durable])
        act(() => result.current.removeQueued("not-held"))
        expect(server.remove).not.toHaveBeenCalled()

        act(() => result.current.removeQueued("input-1"))
        expect(server.remove).toHaveBeenCalledWith("input-1")
        expect(server.submit).not.toHaveBeenCalled()
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
            edit: vi.fn().mockResolvedValue(undefined),
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

describe("durable queued edits", () => {
    it("keeps the edit and draft until same-row persistence succeeds, including a retry", async () => {
        const edit = vi
            .fn()
            .mockRejectedValueOnce(new Error("conflict"))
            .mockResolvedValueOnce(undefined)
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [
                {id: "first", text: "first", source: "server"},
                {id: "selected", text: "old", source: "server"},
            ],
            submit: vi.fn(),
            remove: vi.fn(),
            edit,
        }
        const {result} = setup({...settledEmpty, server})
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
    })

    it("does not submit a new message if the durable row leaves the queue during editing", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [{id: "selected", text: "old", source: "server"}],
            submit: vi.fn(),
            remove: vi.fn(),
            edit: vi.fn().mockRejectedValue(new Error("already promoted")),
        }
        const {result, rerender} = setup({...settledEmpty, server})
        act(() => result.current.beginEdit("selected", "draft"))
        rerender({...settledEmpty, server: {...server, queued: []}})
        await act(async () => {
            await expect(result.current.commitEdit({text: "new"})).rejects.toThrow(
                "already promoted",
            )
        })
        expect(result.current.editingId).toBe("selected")
        expect(server.submit).not.toHaveBeenCalled()
        let restored = ""
        act(() => {
            restored = result.current.cancelEdit()
        })
        expect(restored).toBe("draft")
    })

    it("retains observed server ownership after a failed edit and a later missing snapshot row", async () => {
        const server: ServerQueueAdapter = {
            busy: true,
            queued: [],
            submit: vi.fn(),
            remove: vi.fn(),
            edit: vi
                .fn()
                .mockRejectedValueOnce(new Error("retry"))
                .mockRejectedValueOnce(new Error("promoted")),
        }
        const {result, rerender} = setup({...settledEmpty, server})
        // The session opens before the snapshot lists the row.
        act(() => result.current.beginEdit("input-1", "draft"))
        rerender({...settledEmpty, server: {...server, queued: [{id: "input-1", text: "old"}]}})
        await act(async () => {
            await expect(result.current.commitEdit({text: "corrected"})).rejects.toThrow("retry")
        })
        rerender({...settledEmpty, server: {...server, queued: []}})
        await act(async () => {
            await expect(result.current.commitEdit({text: "corrected"})).rejects.toThrow("promoted")
        })
        expect(server.edit).toHaveBeenCalledTimes(2)
        expect(server.submit).not.toHaveBeenCalled()
        expect(result.current.queued).toEqual([])
        expect(result.current.editingId).toBe("input-1")
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

// ── Wiring the echo of a durable send ─────────────────────────────────────────────────────────
// Reconciliation itself lives in usePendingSendEchoes and is tested there. These cover only what
// this hook is responsible for: showing the send at once, and routing each server outcome to it.

const echoText = (result: {current: {pendingSendRows: UIMessage[]}}) =>
    result.current.pendingSendRows.map((row) =>
        row.parts.map((part) => ("text" in part ? part.text : "")).join(""),
    )

describe("useAgentChatQueue durable send echoes", () => {
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
