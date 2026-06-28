import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react"

import {agentShouldResumeAfterApproval, buildAgentRequest} from "@agenta/playground"
import {generateId} from "@agenta/shared/utils"
import {useChat} from "@ai-sdk/react"
import {Attachments, Bubble, Sender} from "@ant-design/x"
import {ArrowDown, Paperclip} from "@phosphor-icons/react"
import {type UIMessage} from "ai"
import {Button, Modal, Tabs, Tag, Tooltip} from "antd"
import type {UploadFile} from "antd"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {AgentChatTransport} from "./assets/AgentChatTransport"
import {filesToParts} from "./assets/files"
import {messageText, sideEffectingToolsInRange} from "./assets/rewind"
import AgentMessage from "./components/AgentMessage"
import SessionHistoryMenu from "./components/SessionHistoryMenu"
import SessionTabLabel from "./components/SessionTabLabel"
import {useChatScopeKey} from "./state/scope"
import {
    type AgentChatSession,
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    closeSessionAtomFamily,
    persistSessionMessagesAtom,
    renameSessionAtomFamily,
    sessionFirstUserTextAtomFamily,
    sessionMessagesAtom,
    sessionsListAtomFamily,
    setActiveSessionAtomFamily,
} from "./state/sessions"

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
const ignoreStreamRejection = () => {}

/**
 * One agent conversation for a single session tab. A `useChat` whose transport is fed by the
 * PLAYGROUND request builder (`buildAgentRequest`) — the entity supplies the config/auth/
 * references, the session id is the tab's id and travels to the backend as `session_id`.
 * Messages persist to localStorage (seeded on mount, written when the stream settles) so the
 * tab survives a reload / revision swap.
 *
 * Design decisions baked in (docs/design/agent-workflows/playground-agent-generation.md):
 *  - D9  teardown: abort the in-flight stream on unmount (tab close / revision swap).
 *  - DT3 cancelled state: a stopped stream tags its partial bubble "Stopped" + offers Resend.
 *  - DT4 autoscroll: stick to bottom while streaming; pause when scrolled up; "jump to latest".
 *  - DT5 a11y: the message log is an aria-live region; controls are keyboard-operable.
 */

/** A settled assistant turn with no content at all — no answer, reasoning, tool, file, or
 * source part. Mirrors AgentMessage's `!hasContent`; used to collapse a run of "no response"
 * bubbles (e.g. repeated failed runs) down to the first one. */
const isEmptyAssistantTurn = (m: UIMessage): boolean =>
    m.role === "assistant" &&
    !m.parts.some(
        (p) =>
            (p.type === "text" && Boolean((p as {text?: string}).text?.trim())) ||
            (p.type === "reasoning" && Boolean((p as {text?: string}).text?.trim())) ||
            p.type === "file" ||
            p.type === "source-url" ||
            p.type.startsWith("tool-") ||
            p.type === "dynamic-tool",
    )

interface ParsedRunError {
    message: string
    code?: number
}

/**
 * Best-effort human reason from a useChat stream error. The server may hand us a clean string
 * ("Agent run failed: …") or a JSON envelope (`{status:{code,message,…}}` / `{message}`) — pull
 * the message out of either and drop the stacktrace / docs-url noise so it reads cleanly inline.
 */
const parseAgentRunError = (err: unknown): ParsedRunError => {
    const raw =
        err instanceof Error ? err.message : typeof err === "string" ? err : String(err ?? "")
    const fallback = raw.trim() || "The agent run failed."
    try {
        const obj = JSON.parse(raw) as Record<string, unknown>
        const status = (obj?.status && typeof obj.status === "object" ? obj.status : obj) as Record<
            string,
            unknown
        >
        const message =
            typeof status?.message === "string"
                ? status.message
                : typeof obj?.message === "string"
                  ? (obj.message as string)
                  : null
        if (message) {
            return {message, code: typeof status?.code === "number" ? status.code : undefined}
        }
    } catch {
        // raw isn't JSON — it's already the human message.
    }
    return {message: fallback}
}

/** The last real content element in the log (the last turn's last child). Used to measure the REAL
 * content bottom and ignore the min-h-full reserve that pads a streaming turn — so the jump pill and
 * stick-to-bottom track the latest message, not the bottom of the empty reserved space. */
const lastContentEl = (el: HTMLElement): HTMLElement | null => {
    const wrappers = el.querySelectorAll<HTMLElement>("[data-mid]")
    const wrapper = wrappers[wrappers.length - 1]
    if (!wrapper) return null
    return (wrapper.lastElementChild as HTMLElement | null) ?? wrapper
}

/** True when the latest message content sits at or above the viewport bottom (i.e. fully visible). */
const atLiveEdge = (el: HTMLElement): boolean => {
    const last = lastContentEl(el)
    if (!last) return true
    return last.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom < 24
}

const AgentConversation = ({entityId, sessionId}: {entityId: string; sessionId: string}) => {
    const store = useStore()
    const persistMessages = useSetAtom(persistSessionMessagesAtom)

    const [input, setInput] = useState("")
    const [files, setFiles] = useState<UploadFile[]>([])
    const [attachmentsOpen, setAttachmentsOpen] = useState(false)
    // Whether the LAST assistant turn was user-stopped. You can only cancel the in-flight (last) turn,
    // so this is a single boolean gated on position at render time — independent of message ids (which
    // can be missing/duplicated in restore/error paths and would otherwise smear the tag onto every
    // turn). Cleared on the next send/resend.
    const [stopped, setStopped] = useState(false)
    // Seed once from the persisted store (read imperatively so our own writes don't feed back).
    const [initialMessages] = useState(() => store.get(sessionMessagesAtom)[sessionId] ?? [])

    const senderRef = useRef<React.ComponentRef<typeof Sender>>(null)
    const dropContainerRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    // SC-2: a restored thread opens parked (not following) at the last user message; a brand-new empty
    // session follows the bottom as the first answer streams.
    const stickRef = useRef(initialMessages.length === 0)
    const [showJump, setShowJump] = useState(false)
    // Arm a one-shot scroll that pins a user message to the top once it has mounted. Used both for a
    // freshly-submitted turn (SC-1) and, when a saved thread is restored, for its last user message
    // (SC-2) — both resolve "the last user message" the same way in the pin effect below.
    const armPinRef = useRef(initialMessages.some((m) => m.role === "user"))
    // Set while we move the scroll position ourselves (the SC-1 pin). onScroll ignores the resulting
    // event so a programmatic pin isn't mistaken for the user reaching the live edge (which would flip
    // stick-to-bottom on and jam the view back down, undoing the pin).
    const programmaticScrollRef = useRef(false)

    // Transport feeds the v6 stream request from the playground pipeline. `api` here is a
    // placeholder that `prepareSendMessagesRequest` overrides per request.
    const transport = useMemo(
        () =>
            new AgentChatTransport({
                api: "",
                prepareSendMessagesRequest: async ({messages, id}) => {
                    const req = await buildAgentRequest(entityId, messages, {
                        sessionId: id ?? sessionId,
                    })
                    if (!req) {
                        throw new Error(
                            "This agent workflow has no invocation URL — it can’t be run yet.",
                        )
                    }
                    return {api: req.invocationUrl, headers: req.headers, body: req.requestBody}
                },
            }),
        [entityId, sessionId],
    )

    const {
        messages,
        sendMessage,
        status,
        stop,
        regenerate,
        setMessages,
        addToolApprovalResponse,
        error,
    } = useChat({
        id: sessionId,
        messages: initialMessages,
        transport,
        // Approve AND deny both resume — a deny-only decision must re-send so the runner
        // gets the denial round-trip and the model continues (no `approval-responded` limbo).
        sendAutomaticallyWhen: agentShouldResumeAfterApproval,
        onError: (err) => {
            // Render the error in-chat (the `error` alert below); swallow it here so an
            // aborted/errored stream doesn't bubble unhandled to the Next.js dev overlay (F-033).
            console.warn("[AgentChatPanel] useChat error (rendered in-chat):", err)
        },
    })

    const busy = status === "submitted" || status === "streaming"

    // Surface a stream failure inline: stamp the parsed error onto the failing assistant turn so
    // it renders as a red error bubble with the real reason (and persists with the session via the
    // effect below), instead of a transient top banner + a generic "no response". FE-only — it
    // uses the error useChat already has; the backend doesn't need to attach it to the trace.
    useEffect(() => {
        if (!error) return
        const parsed = parseAgentRunError(error)
        setMessages((prev) => {
            const last = prev.length > 0 ? prev[prev.length - 1] : undefined
            const existing = (last?.metadata as {runError?: {message?: string}} | undefined)
                ?.runError
            if (last?.role === "assistant") {
                if (existing?.message === parsed.message) return prev // already stamped
                const next = [...prev]
                next[next.length - 1] = {
                    ...last,
                    metadata: {...(last.metadata as object | undefined), runError: parsed},
                }
                return next
            }
            // No trailing assistant turn (failed before one existed) — add a minimal carrier.
            return [
                ...prev,
                {
                    id: `run-error-${generateId()}`,
                    role: "assistant",
                    parts: [],
                    metadata: {runError: parsed},
                } as (typeof prev)[number],
            ]
        })
    }, [error, setMessages])

    // Persist the conversation whenever its stream settles (skip mid-stream).
    useEffect(() => {
        if (status === "streaming") return
        persistMessages({id: sessionId, messages})
    }, [messages, status, sessionId, persistMessages])

    // ── DT3 cancelled state: wrap stop() to mark the in-flight assistant turn ──
    const markStopped = useCallback(() => {
        const last = messages[messages.length - 1]
        if (last && last.role === "assistant") setStopped(true)
    }, [messages])

    const handleStop = useCallback(() => {
        markStopped()
        stop()
    }, [markStopped, stop])

    // ── D9 teardown: abort the in-flight stream on unmount (tab close / revision swap) ──
    // Keyed on sessionId: closing a tab or swapping the revision unmounts this conversation
    // and should tear down its stream.
    useEffect(() => {
        return () => {
            stop()
        }
    }, [sessionId, stop])

    // ── DT4 autoscroll: stick to the bottom of the scrollable area while following ──
    // The fill (min-h-full turn group) makes "question at top" the scroll bottom for a short answer
    // and the answer's end the bottom for a long one, so scrollHeight is the right target (+ pb-6 gap).
    const scrollToBottom = useCallback(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [])

    useEffect(() => {
        if (stickRef.current) scrollToBottom()
    }, [messages, status, scrollToBottom])

    const onScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el) return
        // Ignore the scroll event our own pin produced — only a real user scroll changes follow state.
        if (programmaticScrollRef.current) return
        // Follow ONLY when at the very bottom of the scrollable area; a partial scroll must not enable
        // it (that was the yank). The jump pill instead tracks whether the real latest message is in view.
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        setShowJump(!atLiveEdge(el))
    }, [])

    const jumpToLatest = useCallback(() => {
        stickRef.current = true
        setShowJump(false)
        scrollToBottom()
    }, [scrollToBottom])

    // Pin the last user message to the top of the viewport, one time, when armed: on a fresh submit
    // (SC-1, so the answer streams into the fill below) and on restoring a saved thread (SC-2, so it
    // reopens at the last meaningful turn rather than the absolute bottom).
    useLayoutEffect(() => {
        if (!armPinRef.current) return
        const el = scrollRef.current
        if (!el) return
        const lastUser = [...messages].reverse().find((m) => m.role === "user")
        if (!lastUser) return
        let node: HTMLElement | null = null
        try {
            node = el.querySelector<HTMLElement>(`[data-mid="${lastUser.id}"]`)
        } catch {
            node = null
        }
        if (!node) return
        armPinRef.current = false
        programmaticScrollRef.current = true
        const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
        el.scrollTop = Math.max(0, top - 12)
        requestAnimationFrame(() => {
            programmaticScrollRef.current = false
        })
    }, [messages])

    // Keep the jump pill honest as content streams/settles: show it when the real latest message is
    // below the fold (e.g. a long answer growing past the viewport while parked at the top), and hide
    // it once that message is visible or while we're following.
    useLayoutEffect(() => {
        const el = scrollRef.current
        if (el) setShowJump(!stickRef.current && !atLiveEdge(el))
    }, [messages, status])

    const handleSubmit = async (text: string) => {
        const trimmed = text.trim()
        const fileObjs = files
            .map((f) => f.originFileObj as File | undefined)
            .filter((f): f is File => Boolean(f))
        if ((!trimmed && fileObjs.length === 0) || busy) return
        const fileParts = fileObjs.length ? await filesToParts(fileObjs) : undefined
        // SC-1: pin the new turn to the top; the answer streams into the space below it. We park the
        // view (not following) and clear any prior "stopped" marker — it's resolved by asking again.
        stickRef.current = false
        armPinRef.current = true
        setShowJump(false)
        setStopped(false)
        // Swallow the rejection — a stream error/abort is already surfaced via `onError` and
        // the in-chat `error` alert; without this it bubbles to the Next.js dev overlay (F-033).
        sendMessage(
            fileParts
                ? trimmed
                    ? {text: trimmed, files: fileParts}
                    : {files: fileParts}
                : {text: trimmed},
        ).catch(ignoreStreamRejection)
        setInput("")
        setFiles([])
        setAttachmentsOpen(false)
    }

    const handleRewind = (message: UIMessage) => {
        if (busy) return
        const idx = messages.findIndex((m) => m.id === message.id)
        if (idx < 0) return
        const isUser = message.role === "user"
        const sideEffects = sideEffectingToolsInRange(messages.slice(idx))

        const run = () => {
            if (isUser) {
                setMessages(messages.slice(0, idx))
                setInput(messageText(message))
                requestAnimationFrame(() => senderRef.current?.focus())
            } else {
                regenerate({messageId: message.id}).catch(ignoreStreamRejection)
            }
        }

        if (sideEffects.length > 0) {
            Modal.confirm({
                title: "Rewind past a tool that already ran?",
                content: `${sideEffects.join(", ")} already executed. Rewinding re-runs the conversation from here but will NOT undo it.`,
                okText: "Rewind anyway",
                okButtonProps: {danger: true},
                cancelText: "Cancel",
                onOk: run,
            })
        } else {
            run()
        }
    }

    // Group the ACTIVE turn (the last user message + its response) into one wrapper that carries the
    // fill. Keeping the fill on a STABLE element — not hopping it from the user bubble to the assistant
    // bubble when the answer arrives — avoids the mid-stream layout jump.
    const lastUserIndex = (() => {
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i
        return -1
    })()
    const activeStart = lastUserIndex >= 0 ? lastUserIndex : messages.length
    // The fill = min-h-full on the active turn whenever there's PRIOR conversation above it (so the
    // question can sit at the top). Derived from layout, NOT from `busy` — so it persists when the turn
    // settles instead of being yanked away (which clamped the scroll and jumped the view).
    const reserveActive = activeStart > 0

    const renderMessage = (message: UIMessage, index: number) => {
        const isLast = index === messages.length - 1
        return (
            <div key={message.id} data-mid={message.id} className="flex flex-col gap-1">
                <AgentMessage
                    message={message}
                    isStreaming={busy && isLast}
                    onRewind={() => handleRewind(message)}
                    onApprovalResponse={addToolApprovalResponse}
                    precededByEmptyAssistant={
                        index > 0 && isEmptyAssistantTurn(messages[index - 1])
                    }
                />
                {/* Waiting indicator stays inside the last message so the reserve keeps it on-screen. */}
                {isLast && status === "submitted" && message.role !== "assistant" && (
                    <Bubble placement="start" variant="outlined" loading content="" />
                )}
                {/* Stopped tag + Resend belong only to the LAST assistant turn (the one you cancelled),
                    gated on position so it can never smear onto past turns. Cleared on resend / ask. */}
                {stopped && isLast && message.role === "assistant" && (
                    <div className="flex items-center gap-2 self-start pl-1">
                        <Tag className="!m-0 !text-[11px]">Stopped</Tag>
                        <Button
                            type="link"
                            size="small"
                            className="!px-0 !text-xs"
                            disabled={busy}
                            onClick={() => {
                                setStopped(false)
                                regenerate({messageId: message.id}).catch(ignoreStreamRejection)
                            }}
                        >
                            Resend
                        </Button>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-3">
            {/* Stream errors are surfaced inline on the failing turn (red error bubble with the
                real reason), stamped in the effect above — no separate top-level banner. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                    ref={(el) => {
                        scrollRef.current = el
                        dropContainerRef.current = el
                    }}
                    onScroll={onScroll}
                    role="log"
                    aria-live="polite"
                    aria-label="Agent conversation"
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 pb-6"
                >
                    {messages.length === 0 && (
                        <div className="m-auto text-center text-xs text-colorTextTertiary">
                            Ask a question to start the agent conversation.
                        </div>
                    )}
                    {messages.slice(0, activeStart).map((m, i) => renderMessage(m, i))}
                    {activeStart < messages.length && (
                        // SC-1: the active turn reserves a viewport (min-h-full) while streaming with
                        // prior conversation above, so the question pins to the top and the answer
                        // lands below it. One stable wrapper for the whole turn → no mid-stream jump.
                        <div className={`flex flex-col gap-3${reserveActive ? " min-h-full" : ""}`}>
                            {messages
                                .slice(activeStart)
                                .map((m, i) => renderMessage(m, activeStart + i))}
                        </div>
                    )}
                </div>

                {showJump && (
                    <Button
                        size="small"
                        shape="round"
                        icon={<ArrowDown size={14} />}
                        onClick={jumpToLatest}
                        // Solid elevated surface + border + shadow so the pill reads clearly when it
                        // floats over streamed text (a transparent pill let the text bleed through).
                        className="!absolute bottom-2 left-1/2 -translate-x-1/2 !border !border-solid !border-colorBorderSecondary !bg-colorBgElevated shadow-md"
                        aria-label="Jump to latest message"
                    >
                        Jump to latest
                    </Button>
                )}
            </div>

            <Sender
                ref={senderRef}
                value={input}
                onChange={setInput}
                loading={busy}
                onSubmit={handleSubmit}
                onCancel={handleStop}
                onPasteFile={(pasted) => {
                    setFiles((prev) => [
                        ...prev,
                        ...Array.from(pasted).map((file) => ({
                            uid: `${file.name}-${file.lastModified}-${file.size}`,
                            name: file.name,
                            status: "done" as const,
                            originFileObj: file as UploadFile["originFileObj"],
                        })),
                    ])
                    setAttachmentsOpen(true)
                }}
                prefix={
                    <Tooltip title="Attach files">
                        <Button
                            type="text"
                            size="small"
                            icon={<Paperclip size={16} />}
                            onClick={() => setAttachmentsOpen((open) => !open)}
                            aria-label="Attach files"
                        />
                    </Tooltip>
                }
                header={
                    <div
                        className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
                            attachmentsOpen || files.length > 0
                                ? "grid-rows-[1fr] opacity-100"
                                : "grid-rows-[0fr] opacity-0"
                        }`}
                    >
                        <div className="min-h-0 overflow-hidden">
                            <div className="border-b border-solid border-colorBorderSecondary p-2">
                                <Attachments
                                    items={files}
                                    beforeUpload={() => false}
                                    onChange={({fileList}) => setFiles(fileList)}
                                    getDropContainer={() => dropContainerRef.current}
                                    placeholder={(type) => ({
                                        title: type === "drop" ? "Drop files here" : "Attach files",
                                        description:
                                            "Click or drag — sent inline to the agent as data URLs.",
                                    })}
                                />
                            </div>
                        </div>
                    </div>
                }
                placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"
            />
        </div>
    )
}

/**
 * AgentChatPanel — the agent-generation surface hosted INSIDE the playground (the third
 * generation arm beside chat and completion).
 *
 * Single view keeps the slice's editable-card session tab bar (design decision D2): parallel
 * conversations, add with `+`, close with `×`, double-click to rename. Sessions are app-scoped
 * (shared with the rest of the playground) and persist to localStorage, so tabs survive a
 * reload; antd keeps visited panes mounted, so switching tabs preserves a session's live
 * stream / approval state. Each tab is its own `useChat` driven by `buildAgentRequest` against
 * the current `entityId` (so the run always uses the live draft config).
 */
/**
 * Tab label, scoped to its own session: subscribes only to that session's first-user-text
 * (a stable string), so a streaming conversation doesn't re-render the whole tab bar / every
 * mounted pane on each token.
 */
const TabLabel = ({
    session,
    index,
    onRename,
}: {
    session: AgentChatSession
    index: number
    onRename: (title: string) => void
}) => {
    const text = useAtomValue(sessionFirstUserTextAtomFamily(session.id))
    const truncated = text.length > 24 ? `${text.slice(0, 24)}…` : text
    return (
        <SessionTabLabel
            label={session.title || truncated || `Chat ${index + 1}`}
            onRename={onRename}
        />
    )
}

const AgentChatPanel = ({entityId}: {entityId: string}) => {
    const scope = useChatScopeKey()
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const addSession = useSetAtom(addSessionAtomFamily(scope))
    const closeSession = useSetAtom(closeSessionAtomFamily(scope))
    const renameSession = useSetAtom(renameSessionAtomFamily(scope))
    const setActiveSession = useSetAtom(setActiveSessionAtomFamily(scope))

    // Always keep at least one tab. Re-arms when the list drains without double-firing
    // under StrictMode.
    const seeded = useRef(false)
    useEffect(() => {
        if (sessions.length === 0 && !seeded.current) {
            seeded.current = true
            addSession()
        }
        if (sessions.length > 0) seeded.current = false
    }, [sessions.length, addSession])

    // Tolerate a stale active id (its tab was closed) by falling back to the first tab.
    const activeId = sessions.some((s) => s.id === rawActiveId) ? rawActiveId : sessions[0]?.id

    return (
        <div className="flex h-full min-h-0 w-full flex-col p-3">
            <Tabs
                type="editable-card"
                size="small"
                className="flex min-h-0 flex-1 flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-nav]:!mb-0 [&_.ant-tabs-nav]:!-mx-3 [&_.ant-tabs-nav]:!px-3 [&_.ant-tabs-tabpane]:h-full"
                activeKey={activeId}
                onChange={setActiveSession}
                onEdit={(targetKey, action) => {
                    if (action === "add") addSession()
                    else if (typeof targetKey === "string") closeSession(targetKey)
                }}
                tabBarExtraContent={{right: <SessionHistoryMenu />}}
                items={sessions.map((session, index) => ({
                    key: session.id,
                    closable: sessions.length > 1,
                    label: (
                        <TabLabel
                            session={session}
                            index={index}
                            onRename={(title) => renameSession({id: session.id, title})}
                        />
                    ),
                    children: <AgentConversation entityId={entityId} sessionId={session.id} />,
                }))}
            />
        </div>
    )
}

export default AgentChatPanel
