import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {buildAgentRequest} from "@agenta/playground"
import {useChat} from "@ai-sdk/react"
import {Attachments, Bubble, Sender} from "@ant-design/x"
import {ArrowDown, Paperclip} from "@phosphor-icons/react"
import {lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage} from "ai"
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

const AgentConversation = ({entityId, sessionId}: {entityId: string; sessionId: string}) => {
    const store = useStore()
    const persistMessages = useSetAtom(persistSessionMessagesAtom)

    const [input, setInput] = useState("")
    const [files, setFiles] = useState<UploadFile[]>([])
    const [attachmentsOpen, setAttachmentsOpen] = useState(false)
    // Ids of assistant turns whose stream was stopped (user-cancel or teardown).
    const [stoppedIds, setStoppedIds] = useState<Set<string>>(() => new Set())
    // Seed once from the persisted store (read imperatively so our own writes don't feed back).
    const [initialMessages] = useState(() => store.get(sessionMessagesAtom)[sessionId] ?? [])

    const senderRef = useRef<React.ComponentRef<typeof Sender>>(null)
    const dropContainerRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const stickRef = useRef(true)
    const [showJump, setShowJump] = useState(false)

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
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
        onError: (err) => {
            console.error("[AgentChatPanel] useChat error:", err)
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
                    id: `run-error-${crypto.randomUUID()}`,
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
        if (last && last.role === "assistant") {
            setStoppedIds((prev) => new Set(prev).add(last.id))
        }
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

    // ── DT4 autoscroll: stick to bottom while streaming unless scrolled up ──
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
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        stickRef.current = atBottom
        setShowJump(!atBottom)
    }, [])

    const jumpToLatest = useCallback(() => {
        stickRef.current = true
        setShowJump(false)
        scrollToBottom()
    }, [scrollToBottom])

    const handleSubmit = async (text: string) => {
        const trimmed = text.trim()
        const fileObjs = files
            .map((f) => f.originFileObj as File | undefined)
            .filter((f): f is File => Boolean(f))
        if ((!trimmed && fileObjs.length === 0) || busy) return
        const fileParts = fileObjs.length ? await filesToParts(fileObjs) : undefined
        stickRef.current = true
        setShowJump(false)
        sendMessage(
            fileParts
                ? trimmed
                    ? {text: trimmed, files: fileParts}
                    : {files: fileParts}
                : {text: trimmed},
        )
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
                regenerate({messageId: message.id})
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

    const lastId = messages[messages.length - 1]?.id

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
                    className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-md border border-solid border-colorBorderSecondary p-3"
                >
                    {messages.length === 0 && (
                        <div className="m-auto text-center text-xs text-colorTextTertiary">
                            Ask a question to start the agent conversation.
                        </div>
                    )}
                    {messages.map((message, index) => (
                        <div key={message.id} className="flex flex-col gap-1">
                            <AgentMessage
                                message={message}
                                busy={busy}
                                isStreaming={busy && index === messages.length - 1}
                                onRewind={() => handleRewind(message)}
                                onApprovalResponse={addToolApprovalResponse}
                                precededByEmptyAssistant={
                                    index > 0 && isEmptyAssistantTurn(messages[index - 1])
                                }
                            />
                            {stoppedIds.has(message.id) && (
                                <div className="flex items-center gap-2 self-start pl-1">
                                    <Tag className="!m-0 !text-[11px]">Stopped</Tag>
                                    {message.id === lastId && (
                                        <Button
                                            type="link"
                                            size="small"
                                            className="!px-0 !text-xs"
                                            disabled={busy}
                                            onClick={() => regenerate({messageId: message.id})}
                                        >
                                            Resend
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    {status === "submitted" &&
                        messages[messages.length - 1]?.role !== "assistant" && (
                            <Bubble placement="start" variant="outlined" loading content="" />
                        )}
                </div>

                {showJump && (
                    <Button
                        size="small"
                        shape="round"
                        icon={<ArrowDown size={14} />}
                        onClick={jumpToLatest}
                        className="!absolute bottom-2 left-1/2 -translate-x-1/2 shadow"
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
                className="flex min-h-0 flex-1 flex-col [&_.ant-tabs-content]:h-full [&_.ant-tabs-content-holder]:min-h-0 [&_.ant-tabs-content-holder]:flex-1 [&_.ant-tabs-nav]:!mb-0 [&_.ant-tabs-tabpane]:h-full"
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
