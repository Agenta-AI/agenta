// @vitest-environment jsdom
import {createElement, createRef, Fragment, useMemo, useRef, useState, type RefObject} from "react"

import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {act, cleanup, fireEvent, render, renderHook, screen, waitFor} from "@testing-library/react"
import type {UIMessage} from "ai"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {DEFAULT_ATTACHMENT_LIMITS} from "../../../src/assets/attachmentRules"
import {isComposerRunStoppable} from "../../../src/assets/composerRunState"
import {ChatComposer} from "../../../src/components/ChatComposer"
import QueuedMessagesDock from "../../../src/components/QueuedMessagesDock"
import {RunningElsewhereStrip} from "../../../src/components/RunningElsewhereStrip"
import {useAgentChatQueue} from "../../../src/hooks/useAgentChatQueue"
import type {useComposerAttachments} from "../../../src/hooks/useComposerAttachments"
import {useServerSessionInputs} from "../../../src/hooks/useServerSessionInputs"

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

vi.mock("@agenta/playground/agent-chat", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/playground/agent-chat")>()),
    buildAgentRequest,
}))

const fetchMock = vi.fn<typeof globalThis.fetch>()
vi.stubGlobal("fetch", fetchMock)

beforeAll(() => {
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
    fetchMock.mockReset()
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
        status: "ready",
        messages: [],
        stopped: false,
        markRunOwned: vi.fn(),
        sendQueued: vi.fn(),
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
        } catch {
            inputRef.current?.setMarkdown(text)
            setRejections([{name: "Message", reason: "wasn't sent — try again."}])
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
        serverControlEnabled: queue.queueEnabled,
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
        createElement(RunningElsewhereStrip),
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
            busyActions:
                server.busy && queue.queueEnabled
                    ? [
                          {label: "Queue", onSubmit: (text) => void submit(text)},
                          ...(queue.steerEnabled
                              ? [
                                    {
                                        label: "Steer",
                                        onSubmit: (text: string) => void submit(text, "steer"),
                                    },
                                ]
                              : []),
                      ]
                    : undefined,
        }),
    )
}

const setupRunningElsewhereAdmission = async ({refuse = false}: {refuse?: boolean} = {}) => {
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
                    closeFreshResponse = () => controller.close()
                },
            })
            return new Response(body, {status: 200})
        }
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
    await screen.findByText(/This turn is still running/)
    await screen.findByLabelText("Chat message")
    await screen.findByRole("button", {name: "Start fresh run"})
    fireEvent.click(screen.getByRole("button", {name: "Start fresh run"}))
    await screen.findByText("Fresh admission released")

    return {closeFreshResponse, inputRef}
}

describe("useServerSessionInputs", () => {
    it("enables Queue from a snapshot without reconnect data", async () => {
        fetchSnapshot.mockResolvedValue({
            session: null,
            execution: null,
            execution_state: {id: null, state: "idle"},
            read: null,
            pending: {inputs: [], interactions: []},
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

        await waitFor(() => expect(result.current.capabilities.queue).toBe(true))
        expect(result.current.capabilities.steer).toBe(true)
        expect(result.current.executionState).toBe("idle")
    })

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

        await waitFor(() => expect(result.current.capabilities.queue).toBe(true))
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
        await waitFor(() => expect(result.current.capabilities.steer).toBe(true))

        await act(async () => {
            await result.current.submit({id: "input-1", text: "start"}, "queue")
        })

        expect(onExecuted).not.toHaveBeenCalled()
        closeResponse()
        await waitFor(() => expect(onExecuted).toHaveBeenCalledOnce())
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
        await waitFor(() => expect(result.current.capabilities.steer).toBe(true))

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
            act(() => inputRef.current?.setMarkdown(text))
            await waitFor(() => expect(inputRef.current?.getMarkdown()).toBe(text))

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
        act(() => inputRef.current?.setMarkdown("keep this draft"))
        fireEvent.click(await screen.findByRole("button", {name: "Queue"}))

        await screen.findByTitle("Message wasn't sent — try again.")
        expect(inputRef.current?.getMarkdown()).toBe("keep this draft")
        expect(screen.queryByText("1 queued message")).toBeNull()
        closeFreshResponse()
    })
})
