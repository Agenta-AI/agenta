// @vitest-environment jsdom
import {createElement, createRef, Fragment, useMemo, useRef, useState, type RefObject} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {act, cleanup, fireEvent, render, renderHook, screen, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS} from "../../../src/assets/attachmentRules"
import {isComposerRunStoppable} from "../../../src/assets/composerRunState"
import {ChatComposer} from "../../../src/components/ChatComposer"
import QueuedMessagesDock from "../../../src/components/QueuedMessagesDock"
import {useAgentChatQueue} from "../../../src/hooks/useAgentChatQueue"
import type {useComposerAttachments} from "../../../src/hooks/useComposerAttachments"
import {useServerSessionInputs} from "../../../src/hooks/useServerSessionInputs"
import {describeRefusedSend} from "../../../src/model/error"

const {buildAgentRequest, fetchSnapshot, removeInput, sendInputNow, updateInput} = vi.hoisted(
    () => ({
        buildAgentRequest: vi.fn(),
        fetchSnapshot: vi.fn(),
        removeInput: vi.fn(),
        sendInputNow: vi.fn(),
        updateInput: vi.fn(),
    }),
)

// Partial mock: the composer pulls in the drive summary (and whatever the session module
// grows next), so spread the real module and override only the atoms this test drives.
vi.mock("@agenta/entities/session", async (importOriginal) => {
    const {atom} = await import("jotai")
    return {
        ...(await importOriginal<typeof import("@agenta/entities/session")>()),
        fetchSessionSnapshotAtom: atom(null, (_get, _set, sessionId: string) =>
            fetchSnapshot(sessionId),
        ),
        updatePendingSessionInputAtom: atom(null, (_get, _set, params) => updateInput(params)),
        sendPendingSessionInputNowAtom: atom(
            null,
            (_get, _set, params: {sessionId: string; inputId: string}) => sendInputNow(params),
        ),
        removePendingSessionInputAtom: atom(
            null,
            (_get, _set, params: {sessionId: string; inputId: string}) => removeInput(params),
        ),
    }
})

vi.mock("@agenta/playground/agent-chat", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/playground/agent-chat")>()),
    buildAgentRequest,
}))

const fetchMock = vi.fn<typeof globalThis.fetch>()
vi.stubGlobal("fetch", fetchMock)

beforeAll(async () => {
    // Load the real lazy editor before the one-second interaction assertions start.
    await import("@agenta/ui/rich-chat-input")
    // Lexical asks the DOM selection's text node for geometry after Enter clears the editor.
    const rect = () => new DOMRect()
    for (const prototype of [
        Node.prototype,
        Text.prototype,
        HTMLElement.prototype,
        Range.prototype,
    ]) {
        Object.defineProperty(prototype, "getBoundingClientRect", {
            configurable: true,
            value: rect,
        })
    }
    Object.defineProperty(Range.prototype, "getClientRects", {
        configurable: true,
        value: () => [],
    })
})

beforeEach(() => {
    buildAgentRequest.mockReset()
    fetchSnapshot.mockReset()
    removeInput.mockReset()
    sendInputNow.mockReset()
    updateInput.mockReset()
    fetchMock.mockReset()
})

/**
 * The fresh run's response is held open on purpose and released at the end of each case. A
 * failing assertion returns before that call, so the release is also registered here: a leaked
 * open stream fails the cases that follow instead of the one that caused it.
 */
let releaseFreshResponse: (() => void) | null = null

afterEach(() => {
    releaseFreshResponse?.()
    releaseFreshResponse = null
})

afterEach(cleanup)

interface PendingInput {
    id: string
    session_id: string
    content: {data: {inputs: {messages: {role: string; content: string}[]}}}
    position: number
    state: "pending"
    policy: "queue" | "steer"
    created_at: null
    promoted_execution_id: null
}

/** The unified snapshot: the reconnect half plus the queue half, as the API now returns it. */
const runningSnapshot = (inputs: PendingInput[] = []) => ({
    session: {
        id: "11111111-1111-4111-8111-111111111111",
        project_id: "22222222-2222-4222-8222-222222222222",
        session_id: "session-1",
    },
    execution: null,
    execution_state: {id: "turn-1", state: "running" as const},
    pending: {inputs, interactions: []},
    read: {latest_sequence: 0, history_complete: true},
    capabilities: {durable_approvals: true, queue: true, steer: true},
})

const RunningElsewhereAdmissionHarness = ({
    inputRef,
}: {
    inputRef: RefObject<RichChatInputHandle | null>
}) => {
    const server = useServerSessionInputs({
        entityId: "revision-1",
        sessionId: "session-1",
        messages: [],
        // The browser owns no AI-SDK stream; only the server snapshot says the run is active.
        locallyBusy: false,
    })
    const queue = useAgentChatQueue({
        messages: [],
        stopped: false,
        server,
    })
    const sending = useRef(false)
    const [freshAdmissionReleased, setFreshAdmissionReleased] = useState(false)
    const [rejections, setRejections] = useState<{name: string; reason: string}[]>([])
    const attachments = useMemo(
        () =>
            ({
                uploadsEnabled: false,
                files: [],
                rejections,
                limits: DEFAULT_ATTACHMENT_LIMITS,
                atMax: false,
                attachmentsSettled: true,
                uploadBlockReason: undefined,
                addFiles: vi.fn(),
                removeFile: vi.fn(),
                dismissRejection: (index: number) =>
                    setRejections((items) => items.filter((_, at) => at !== index)),
                uploads: {retry: vi.fn(), canRetry: vi.fn()},
            }) as unknown as ReturnType<typeof useComposerAttachments>,
        [rejections],
    )

    const submit = async (text: string, policy: "queue" | "steer" = "queue") => {
        // Mirrors the desktop/mobile submit guard that exposed the original loss: the initial
        // fresh-run response must release this before any busy action can be admitted.
        if (sending.current) return
        sending.current = true
        try {
            if (policy === "steer") await queue.steer({text})
            else await queue.submit({text})
        } catch (error) {
            inputRef.current?.setMarkdown(text)
            // The same reader both apps put on this line (AgentConversation, mobile Composer):
            // the refusal's own sentence when it stated one, the standing wording when it did
            // not. Hardcoding the standing wording here would hide whether the send path read
            // the refusal body at all.
            setRejections([{name: "Message", reason: describeRefusedSend(error)}])
        } finally {
            sending.current = false
        }
    }

    const startFreshRun = async () => {
        await submit("start the turn")
        setFreshAdmissionReleased(true)
    }
    const stoppable = isComposerRunStoppable({
        localStreaming: false,
        serverBusy: server.busy,
        waitingOnUser: false,
    })

    return createElement(
        Fragment,
        null,
        createElement(
            "button",
            {type: "button", onClick: () => void startFreshRun()},
            "Start fresh run",
        ),
        freshAdmissionReleased ? createElement("span", null, "Fresh admission released") : null,
        createElement(QueuedMessagesDock, {
            queued: queue.queued,
            onRemove: vi.fn(),
            held: false,
        }),
        createElement(ChatComposer, {
            inputRef,
            onSubmit: (text) => submit(text),
            attachments,
            streaming: stoppable,
            onStop: vi.fn(),
            busyActions: server.busy
                ? [
                      {label: "Queue", onSubmit: (text) => void submit(text)},
                      {label: "Steer", onSubmit: (text) => void submit(text, "steer")},
                  ]
                : undefined,
        }),
    )
}

/** How the stack answers the admission request: accepted, or refused with this status and body. */
interface AdmissionRefusal {
    status: number
    body: string
}

const setupRunningElsewhereAdmission = async ({
    refuse = false,
    refusal,
}: {refuse?: boolean; refusal?: AdmissionRefusal} = {}) => {
    const pending: PendingInput[] = []
    let requestCount = 0
    let closeFreshResponse = () => {}

    fetchSnapshot.mockImplementation(async () => runningSnapshot(pending))
    buildAgentRequest.mockImplementation(
        async (_entityId: string, messages: UIMessage[], options: {sessionId: string}) => {
            const outbound = messages.at(-1)
            const content = (outbound?.parts ?? [])
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("")
            return {
                invocationUrl: "https://agent.test/invoke",
                headers: {Accept: "text/event-stream"},
                requestBody: {
                    session_id: options.sessionId,
                    data: {inputs: {messages: [{role: "user", content}]}},
                },
            }
        },
    )
    fetchMock.mockImplementation(async (_input, init) => {
        requestCount += 1
        if (requestCount === 1) {
            const body = new ReadableStream({
                start(controller) {
                    let closed = false
                    closeFreshResponse = () => {
                        if (closed) return
                        closed = true
                        controller.close()
                    }
                    releaseFreshResponse = closeFreshResponse
                },
            })
            return new Response(body, {status: 200})
        }
        if (refusal) return new Response(refusal.body, {status: refusal.status})
        if (refuse) return new Response(null, {status: 409})

        const request = JSON.parse(String(init?.body)) as {
            data: {inputs: {messages: {role: string; content: string}[]}}
            on_busy: "queue" | "steer"
        }
        const headers = init?.headers as Record<string, string>
        pending.push({
            id: headers["Idempotency-Key"],
            session_id: "session-1",
            content: {data: {inputs: {messages: request.data.inputs.messages}}},
            position: pending.length + 1,
            state: "pending",
            policy: request.on_busy,
            created_at: null,
            promoted_execution_id: null,
        })
        return new Response(null, {status: 202})
    })

    const inputRef = createRef<RichChatInputHandle>()
    render(createElement(RunningElsewhereAdmissionHarness, {inputRef}))
    await screen.findByLabelText("Chat message")
    await screen.findByRole("button", {name: "Start fresh run"})
    fireEvent.click(screen.getByRole("button", {name: "Start fresh run"}))
    await screen.findByText("Fresh admission released")

    return {closeFreshResponse, inputRef}
}

describe("useServerSessionInputs", () => {
    it("reloads the snapshot when project scope becomes available", async () => {
        const store = createStore()
        fetchSnapshot.mockImplementation(async () =>
            store.get(projectIdAtom) ? runningSnapshot([]) : null,
        )
        const {result} = renderHook(
            () =>
                useServerSessionInputs({
                    entityId: "revision-1",
                    sessionId: "session-1",
                    messages: [],
                    locallyBusy: false,
                }),
            {wrapper: ({children}) => createElement(Provider, {store}, children)},
        )
        await waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
        expect(result.current.executionState).toBe("idle")
        act(() => store.set(projectIdAtom, "project-ready"))
        await waitFor(() => expect(result.current.executionState).toBe("running"))
        expect(fetchSnapshot).toHaveBeenCalledTimes(2)
    })

    it("lists queued inputs from a snapshot without reconnect data", async () => {
        fetchSnapshot.mockResolvedValue({
            session: null,
            execution: null,
            execution_state: {id: null, state: "idle"},
            read: null,
            pending: {
                inputs: [
                    {
                        id: "row-1",
                        session_id: "session-1",
                        content: {data: {inputs: {messages: [{role: "user", content: "next"}]}}},
                        position: 1,
                        state: "pending",
                        policy: "queue",
                        created_at: null,
                        promoted_execution_id: null,
                    },
                ],
                interactions: [],
            },
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })

        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [] as UIMessage[],
                locallyBusy: false,
            }),
        )

        await waitFor(() => expect(result.current.queued.map((item) => item.id)).toEqual(["row-1"]))
        expect(fetchSnapshot).toHaveBeenCalledOnce()
        expect(result.current.queued[0].text).toBe("next")
        expect(result.current.executionState).toBe("idle")
    })

    it("shares the mount load with an immediate ready-state refresh", async () => {
        let resolveSnapshot!: (snapshot: ReturnType<typeof runningSnapshot>) => void
        fetchSnapshot.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSnapshot = resolve
                }),
        )

        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [] as UIMessage[],
                locallyBusy: false,
            }),
        )

        await waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
        await act(async () => {
            const refresh = result.current.refresh()
            resolveSnapshot(runningSnapshot())
            await refresh
        })

        expect(fetchSnapshot).toHaveBeenCalledOnce()
        expect(result.current.executionState).toBe("running")
    })

    it.each(["queue", "steer"] as const)(
        "negotiates the current reader readiness for %s admission",
        async (policy) => {
            fetchSnapshot.mockResolvedValue(runningSnapshot())
            buildAgentRequest.mockResolvedValue({
                invocationUrl: "https://agent.test/invoke",
                headers: {},
                requestBody: {},
            })
            fetchMock.mockImplementation(async () => new Response(null, {status: 202}))
            const {result, rerender} = renderHook(
                ({ready}) =>
                    useServerSessionInputs({
                        entityId: "revision-1",
                        sessionId: "session-1",
                        messages: [],
                        locallyBusy: false,
                        isSharedReaderReady: () => ready,
                    }),
                {initialProps: {ready: false}},
            )
            await waitFor(() => expect(result.current.executionState).toBe("running"))
            const submit = result.current.submit
            await act(() => submit({id: "before-ready", text: "first", source: "local"}, policy))
            expect(buildAgentRequest.mock.calls.at(-1)?.[2]).toEqual({
                sessionId: "session-1",
                secretSetup: true,
            })
            rerender({ready: true})
            await act(() => submit({id: "ready", text: "next", source: "local"}, policy))
            expect(buildAgentRequest.mock.calls.at(-1)?.[2]).toEqual({
                sessionId: "session-1",
                sharedResponse: true,
                secretSetup: true,
            })
            rerender({ready: false})
            await act(() => submit({id: "disconnected", text: "last", source: "local"}, policy))
            expect(buildAgentRequest.mock.calls.at(-1)?.[2]).toEqual({
                sessionId: "session-1",
                secretSetup: true,
            })
            expect(
                fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).on_busy),
            ).toEqual([policy, policy, policy])
        },
    )

    it("reads queue support from the snapshot and submits durable admission", async () => {
        fetchSnapshot.mockResolvedValue({
            session: {
                id: "11111111-1111-4111-8111-111111111111",
                project_id: "22222222-2222-4222-8222-222222222222",
                session_id: "session-1",
            },
            execution: null,
            execution_state: {id: "turn-1", state: "running"},
            read: {latest_sequence: 0, history_complete: true},
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

        await waitFor(() => expect(result.current.executionState).toBe("running"))
        expect(result.current.executionState).toBe("running")

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
        expect(buildAgentRequest.mock.calls[0][1].at(-1).parts).toEqual([
            {type: "text", text: "run this next"},
        ])
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

    // An empty text part reaches the model as an empty text content block, which Anthropic-family
    // models refuse (v0.119.1 risk map, entry 5).
    it("sends an attachment-only input with no text part", async () => {
        fetchSnapshot.mockResolvedValue({
            session: {
                id: "11111111-1111-4111-8111-111111111111",
                project_id: "22222222-2222-4222-8222-222222222222",
                session_id: "session-1",
            },
            execution: null,
            execution_state: {id: "turn-1", state: "running"},
            read: {latest_sequence: 0, history_complete: true},
            pending: {inputs: [], interactions: []},
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })
        buildAgentRequest.mockResolvedValue({
            invocationUrl: "https://agent.test/invoke",
            headers: {Accept: "text/event-stream"},
            requestBody: {session_id: "session-1", data: {inputs: {messages: []}}},
        })
        fetchMock.mockResolvedValue(new Response(null, {status: 202}))

        const attachment = {
            type: "file" as const,
            url: "https://files.test/report.pdf",
            mediaType: "application/pdf",
        }
        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [] as UIMessage[],
                locallyBusy: true,
            }),
        )
        await waitFor(() => expect(result.current.executionState).toBe("running"))

        await act(async () => {
            await result.current.submit(
                {id: "input-2", text: "", fileParts: [attachment], source: "local"},
                "queue",
            )
        })

        expect(buildAgentRequest.mock.calls[0][1].at(-1).parts).toEqual([attachment])
    })

    it("releases admission after a fresh run's headers while its response keeps streaming", async () => {
        fetchSnapshot.mockResolvedValue({
            session: {
                id: "11111111-1111-4111-8111-111111111111",
                project_id: "22222222-2222-4222-8222-222222222222",
                session_id: "session-1",
            },
            execution: null,
            execution_state: {id: "turn-1", state: "running"},
            read: {latest_sequence: 0, history_complete: true},
            pending: {inputs: [], interactions: []},
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })
        buildAgentRequest.mockResolvedValue({
            invocationUrl: "https://agent.test/invoke",
            headers: {Accept: "text/event-stream"},
            requestBody: {session_id: "session-1", data: {inputs: {messages: []}}},
        })
        let closeResponse!: () => void
        const body = new ReadableStream({
            start(controller) {
                closeResponse = () => controller.close()
            },
        })
        fetchMock.mockResolvedValue(new Response(body, {status: 200}))
        const onExecuted = vi.fn()
        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [] as UIMessage[],
                locallyBusy: false,
                onExecuted,
            }),
        )
        await waitFor(() => expect(result.current.executionState).toBe("running"))

        await act(async () => {
            await result.current.submit({id: "input-1", text: "start"}, "queue")
        })

        expect(onExecuted).not.toHaveBeenCalled()
        closeResponse()
        await waitFor(() => expect(onExecuted).toHaveBeenCalledOnce())
    })

    const acceptedRunSnapshot = {
        session: {
            id: "11111111-1111-4111-8111-111111111111",
            project_id: "22222222-2222-4222-8222-222222222222",
            session_id: "session-1",
        },
        execution: null,
        execution_state: {id: "turn-1", state: "running"},
        read: {latest_sequence: 0, history_complete: true},
        pending: {inputs: [], interactions: []},
        capabilities: {durable_approvals: true, queue: true, steer: true},
    }
    const acceptedFrame = `data: ${JSON.stringify({
        type: "data-session-accepted",
        data: {executionId: "turn-9"},
    })}\n`

    /** A 200 run whose stream names its turn, then stays open until the test ends it. */
    const acceptedRun = () => {
        let end!: (how: "close" | "drop") => void
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(acceptedFrame))
                end = (how) =>
                    how === "close" ? controller.close() : controller.error(new Error("dropped"))
            },
        })
        fetchMock.mockResolvedValue(new Response(body, {status: 200}))
        return {end: (how: "close" | "drop") => end(how)}
    }

    const submitAccepted = async (onExecuted: () => void | boolean | Promise<void | boolean>) => {
        fetchSnapshot.mockResolvedValue(acceptedRunSnapshot)
        buildAgentRequest.mockResolvedValue({
            invocationUrl: "https://agent.test/invoke",
            headers: {Accept: "text/event-stream"},
            requestBody: {session_id: "session-1", data: {inputs: {messages: []}}},
        })
        const run = acceptedRun()
        const watcher = {onAccepted: vi.fn(), onSettled: vi.fn(), onFailed: vi.fn()}
        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [] as UIMessage[],
                locallyBusy: false,
                onExecuted,
            }),
        )
        await waitFor(() => expect(result.current.executionState).toBe("running"))
        await act(async () => {
            await result.current.submit({id: "input-1", text: "start"}, "queue", watcher)
        })
        await waitFor(() => expect(watcher.onAccepted).toHaveBeenCalledWith("turn-9"))
        return {run, watcher}
    }

    it("settles only after the records re-read it started has landed", async () => {
        // The saved row that retires the echo arrives in that read. Reporting settlement
        // before it landed flagged a delivered message as not sent whenever the read outlived
        // the turn (#6698).
        let finishRead!: (reconciled: boolean) => void
        const onExecuted = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    finishRead = resolve
                }),
        )
        const {run, watcher} = await submitAccepted(onExecuted)

        run.end("close")
        await waitFor(() => expect(onExecuted).toHaveBeenCalledOnce())
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(watcher.onSettled).not.toHaveBeenCalled()

        await act(async () => finishRead(true))
        await waitFor(() => expect(watcher.onSettled).toHaveBeenCalledOnce())
    })

    it("does not settle on a re-read that could not reach the records", async () => {
        const {run, watcher} = await submitAccepted(() => Promise.resolve(false))
        run.end("close")
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(watcher.onSettled).not.toHaveBeenCalled()
        expect(watcher.onFailed).not.toHaveBeenCalled()
    })

    it("does not settle when the connection drops after acceptance", async () => {
        // The turn may still be running on the server; a drop is neither a failure nor an end.
        const onExecuted = vi.fn(() => Promise.resolve(true))
        const {run, watcher} = await submitAccepted(onExecuted)
        run.end("drop")
        await waitFor(() => expect(onExecuted).toHaveBeenCalledOnce())
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(watcher.onSettled).not.toHaveBeenCalled()
        expect(watcher.onFailed).not.toHaveBeenCalled()
    })

    it("rejects a refused Steer admission", async () => {
        fetchSnapshot.mockResolvedValue({
            session: {
                id: "11111111-1111-4111-8111-111111111111",
                project_id: "22222222-2222-4222-8222-222222222222",
                session_id: "session-1",
            },
            execution: null,
            execution_state: {id: "turn-1", state: "running"},
            read: {latest_sequence: 0, history_complete: true},
            pending: {inputs: [], interactions: []},
            capabilities: {durable_approvals: true, queue: true, steer: true},
        })
        buildAgentRequest.mockResolvedValue({
            invocationUrl: "https://agent.test/invoke",
            headers: {Accept: "text/event-stream"},
            requestBody: {session_id: "session-1", data: {inputs: {messages: []}}},
        })
        fetchMock.mockResolvedValue(new Response(null, {status: 409}))
        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [] as UIMessage[],
                locallyBusy: true,
            }),
        )
        await waitFor(() => expect(result.current.executionState).toBe("running"))

        await act(async () => {
            await expect(
                result.current.submit({id: "steer-1", text: "redirect"}, "steer"),
            ).rejects.toThrow("The input was not accepted (409).")
        })
    })

    it.each([
        ["Enter", "queue"],
        ["Queue button", "queue"],
        ["Steer button", "steer"],
    ] as const)(
        "admits %s durably while the source tab looks running elsewhere",
        async (interaction, policy) => {
            const {closeFreshResponse, inputRef} = await setupRunningElsewhereAdmission()
            const text = `say ${interaction}`
            // `setMarkdown` resolves from Lexical's `onUpdate`; the draft exists only after that.
            await act(async () => {
                await inputRef.current?.setMarkdown(text)
            })
            expect(inputRef.current?.getMarkdown()).toBe(text)

            if (interaction === "Enter") {
                const editor = screen.getByLabelText("Chat message")
                fireEvent.focus(editor)
                fireEvent.keyDown(editor, {
                    key: "Enter",
                    code: "Enter",
                    keyCode: 13,
                    which: 13,
                })
            } else {
                await waitFor(() =>
                    expect(
                        screen.getByRole("button", {name: interaction.split(" ")[0]}),
                    ).toBeTruthy(),
                )
                fireEvent.click(screen.getByRole("button", {name: interaction.split(" ")[0]}))
            }

            await screen.findByText("1 queued message")
            const admission = fetchMock.mock.calls.at(-1)?.[1]
            expect(JSON.parse(String(admission?.body))).toMatchObject({on_busy: policy})
            closeFreshResponse()
        },
    )

    it("keeps the draft and shows the failure card when admission is refused elsewhere", async () => {
        const {closeFreshResponse, inputRef} = await setupRunningElsewhereAdmission({refuse: true})
        await act(async () => {
            await inputRef.current?.setMarkdown("keep this draft")
        })
        fireEvent.click(await screen.findByRole("button", {name: "Queue"}))

        await screen.findByTitle("Message wasn't sent — try again.")
        expect(inputRef.current?.getMarkdown()).toBe("keep this draft")
        expect(screen.queryByText("1 queued message")).toBeNull()
        closeFreshResponse()
    })

    /**
     * QA-D6's only visible line, driven end to end.
     *
     * The model-level cases pin `readSendRefusal` and the chip's wording, but they call the
     * reader directly. This drives the send path itself against a refusing stack, so the
     * assertion fails if that path ever goes back to cancelling the 422 body and throwing the
     * status number — the defect QA-D6 named, which the reader alone cannot catch.
     */
    it("puts the refusal's own sentence on the composer, not just a status", async () => {
        const {closeFreshResponse, inputRef} = await setupRunningElsewhereAdmission({
            refusal: {
                status: 422,
                body: JSON.stringify({
                    session_id: "c0432835345f4ef6b1350ba5a807c5e5",
                    status: {
                        code: 422,
                        message: "No model provider is configured.",
                        type: "https://agenta.ai/docs/errors#v1:sdk:unknown-workflow-invoke-error",
                        stacktrace: ["Traceback (most recent call last):\n"],
                    },
                }),
            },
        })
        await act(async () => {
            await inputRef.current?.setMarkdown("keep this draft")
        })
        fireEvent.click(await screen.findByRole("button", {name: "Queue"}))

        await screen.findByTitle("Message wasn't sent — No model provider is configured.")
        // The traceback beside the sentence is for an operator's log, never for this chip.
        expect(screen.queryByText(/Traceback/)).toBeNull()
        expect(inputRef.current?.getMarkdown()).toBe("keep this draft")
        closeFreshResponse()
    })
})

describe("selected queued input Send Now", () => {
    it("uses the selected row identity without invoking or removing its content", async () => {
        fetchSnapshot.mockResolvedValue(runningSnapshot())
        sendInputNow.mockResolvedValue(true)
        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [],
                locallyBusy: true,
            }),
        )
        await waitFor(() => expect(result.current.executionState).toBe("running"))
        await act(() => result.current.sendNow("selected-row"))
        expect(sendInputNow).toHaveBeenCalledWith({sessionId: "session-1", inputId: "selected-row"})
        expect(removeInput).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(fetchSnapshot.mock.calls.length).toBeGreaterThan(1)
    })

    it("surfaces an admission failure without removing the pending input", async () => {
        fetchSnapshot.mockResolvedValue(runningSnapshot())
        sendInputNow.mockResolvedValue(false)
        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [],
                locallyBusy: true,
            }),
        )
        await waitFor(() => expect(result.current.executionState).toBe("running"))
        await expect(result.current.sendNow("selected-row")).rejects.toThrow("could not be sent")
        expect(removeInput).not.toHaveBeenCalled()
    })
})

describe("durable queued input editing", () => {
    it("patches only the chosen row text and new attachments, then reloads the shared snapshot", async () => {
        fetchSnapshot.mockResolvedValue(runningSnapshot())
        updateInput.mockResolvedValue(true)
        const {result} = renderHook(() =>
            useServerSessionInputs({
                entityId: "revision-1",
                sessionId: "session-1",
                messages: [],
                locallyBusy: true,
            }),
        )
        await waitFor(() => expect(result.current.executionState).toBe("running"))
        await act(() =>
            result.current.edit("row-2", {
                text: "corrected",
                fileParts: [
                    {
                        type: "file",
                        url: "https://files.test/new.pdf",
                        mediaType: "application/pdf",
                        filename: "new.pdf",
                        providerMetadata: {agenta: {attachmentId: "attachment-1"}},
                    },
                ],
            }),
        )
        expect(updateInput).toHaveBeenCalledWith({
            sessionId: "session-1",
            inputId: "row-2",
            text: "corrected",
            attachments: [
                {
                    uri: "https://files.test/new.pdf",
                    mime_type: "application/pdf",
                    filename: "new.pdf",
                    attachment_id: "attachment-1",
                },
            ],
        })
        expect(fetchSnapshot.mock.calls.length).toBeGreaterThan(1)
        expect(removeInput).not.toHaveBeenCalled()
        expect(buildAgentRequest).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
