import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {agentShouldResumeAfterApproval} from "@agenta/playground"
import {useChat} from "@ai-sdk/react"
import {Attachments, Bubble, Sender} from "@ant-design/x"
import {Paperclip} from "@phosphor-icons/react"
import {type UIMessage} from "ai"
import {Alert, Button, Modal, Tag, Tooltip, Typography, type UploadFile} from "antd"
import {useSetAtom, useStore} from "jotai"

import {useAgConfigStatus} from "../assets/agConfig"
import {type AgentChatTrack, trackApi} from "../assets/constants"
import {filesToParts} from "../assets/files"
import {messageText, sideEffectingToolsInRange} from "../assets/rewind"
import {createAgentChatTransport} from "../assets/transport"
import {persistSessionMessagesAtom, sessionMessagesAtom} from "../state/sessions"

import AgentMessage from "./AgentMessage"
import type {ClientToolOutputHandler} from "./clientTools"

const {Text} = Typography

/** A stream error/abort is already surfaced via `useChat`'s `onError` + the in-chat `error`
 * alert; swallow the floating `sendMessage`/`regenerate` rejection so it doesn't bubble to the
 * Next.js dev Runtime Error overlay (F-033). */
const ignoreStreamRejection = () => {}

/** Reactive badge: shows whether the real per-revision `ag_config` has loaded (and keeps
 * the latest-revision query warm so the transport can read it at send time). */
const ConfigBadge = ({appId}: {appId: string}) => {
    const {ready, version} = useAgConfigStatus(appId)
    return ready ? (
        <Tag color="success" className="!m-0 !text-[11px]">
            config: revision{version != null ? ` v${version}` : ""}
        </Tag>
    ) : (
        <Tag className="!m-0 !text-[11px]">config: loading… (stub until ready)</Tag>
    )
}

/**
 * One `useChat` conversation for a single request-contract track, rendered with Ant Design X
 * (`Bubble` per message + `Sender` composer). The parent remounts this (via `key={track}`)
 * when the track changes, so each track gets a clean session and a fresh transport. The
 * streamed response + rendering are identical across tracks; only the outgoing request body
 * differs (watch the Network tab to compare).
 *
 * When `appId` is set (the page is app-scoped), the transport sends the real `ag_config` +
 * `references` resolved from that app's latest revision; otherwise it falls back to a stub.
 */
const AgentChatConversation = ({
    sessionId,
    track,
    appId,
}: {
    sessionId: string
    track: AgentChatTrack
    appId: string | null
}) => {
    const store = useStore()
    const persistMessages = useSetAtom(persistSessionMessagesAtom)
    // Themed confirm dialogs: the hook form's contextHolder renders in-tree so it inherits the app
    // theme (the static Modal.confirm renders detached and loses it — white box in dark mode).
    const [modal, modalContextHolder] = Modal.useModal()
    const [input, setInput] = useState("")
    // Pending attachments for the next message. Kept client-side only: `beforeUpload`
    // returns false so antd never uploads; we read each `originFileObj` into a data: URL at
    // send time (see `filesToParts`).
    const [files, setFiles] = useState<UploadFile[]>([])
    const [attachmentsOpen, setAttachmentsOpen] = useState(false)
    // Seed once from the persisted store (read imperatively so our own writes below don't
    // feed back). The session id is owned by the tab and travels to the backend as
    // `session_id`; the `:${track}` in the parent's key remounts on a dev track flip, which
    // rehydrates from here with a fresh transport.
    const [initialMessages] = useState(() => store.get(sessionMessagesAtom)[sessionId] ?? [])
    const senderRef = useRef<React.ComponentRef<typeof Sender>>(null)
    const dropContainerRef = useRef<HTMLDivElement>(null)
    const transport = useMemo(() => createAgentChatTransport(track, appId), [track, appId])

    const {
        messages,
        sendMessage,
        status,
        stop,
        regenerate,
        setMessages,
        addToolApprovalResponse,
        addToolOutput,
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
            console.warn("[AgentChatSlice] useChat error (rendered in-chat):", err)
        },
    })

    const busy = status === "submitted" || status === "streaming"

    // Settle a parked client tool (#4920) — same wrapper as AgentChatPanel. `addToolOutput` matches
    // the part by `toolCallId` on the last turn; `tool` is only the typed-tools key, so a cast onto
    // the untyped UIMessage tool map is safe.
    const handleClientToolOutput = useCallback<ClientToolOutputHandler>(
        ({toolName, toolCallId, output, errorText}) => {
            if (errorText !== undefined) {
                addToolOutput({
                    state: "output-error",
                    tool: toolName as never,
                    toolCallId,
                    errorText,
                }).catch(ignoreStreamRejection)
            } else {
                addToolOutput({
                    tool: toolName as never,
                    toolCallId,
                    output: (output ?? {}) as never,
                }).catch(ignoreStreamRejection)
            }
        },
        [addToolOutput],
    )

    // `handleRewind` must stay referentially stable (it's passed to every memo'd `AgentMessage`)
    // so a streamed token doesn't recreate it and re-render the whole list. `messages`/`busy`
    // change every token, so read them through refs instead of capturing them in the closure.
    // The refs are synced in an effect (not during render) — `handleRewind` only reads them from
    // event handlers, which run post-commit, so the latest committed value is always current.
    const messagesRef = useRef(messages)
    const busyRef = useRef(busy)
    useEffect(() => {
        messagesRef.current = messages
        busyRef.current = busy
    }, [messages, busy])

    // Persist the conversation whenever its stream settles (skip mid-stream so we don't
    // write on every token). Covers send (status "submitted"), finish/error ("ready"/
    // "error"), and clear/rewind (setMessages → "ready").
    useEffect(() => {
        if (status === "streaming") return
        persistMessages({id: sessionId, messages})
    }, [messages, status, sessionId, persistMessages])

    const handleSubmit = async (text: string) => {
        const trimmed = text.trim()
        const fileObjs = files
            .map((f) => f.originFileObj as File | undefined)
            .filter((f): f is File => Boolean(f))
        if ((!trimmed && fileObjs.length === 0) || busy) return
        // Read attachments into data: URL `file` parts; `sendMessage` adds them to the
        // outgoing user message alongside the text part.
        const fileParts = fileObjs.length ? await filesToParts(fileObjs) : undefined
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

    /**
     * Rewind the conversation to `message` (truncate-in-place). A user turn drops it +
     * everything after and prefills the composer with its text to edit/resend; an assistant
     * turn re-runs via `regenerate`. Confirms first if the dropped range contains a tool that
     * already ran with a side effect (a rewind can't undo it).
     */
    const handleRewind = useCallback(
        (message: UIMessage) => {
            const msgs = messagesRef.current
            if (busyRef.current) return
            const idx = msgs.findIndex((m) => m.id === message.id)
            if (idx < 0) return
            const isUser = message.role === "user"
            // Everything from here on is dropped/re-run; already-executed side effects in this
            // tail (incl. the assistant turn's own tools, which regenerate re-fires) won't undo.
            const sideEffects = sideEffectingToolsInRange(msgs.slice(idx))

            const run = () => {
                if (isUser) {
                    setMessages(msgs.slice(0, idx))
                    setInput(messageText(message))
                    // Focus the composer so the user can edit the restored text immediately.
                    requestAnimationFrame(() => senderRef.current?.focus())
                } else {
                    regenerate({messageId: message.id}).catch(ignoreStreamRejection)
                }
            }

            if (sideEffects.length > 0) {
                modal.confirm({
                    title: "Rewind past a tool that already ran?",
                    content: `${sideEffects.join(", ")} already executed. Rewinding re-runs the conversation from here but will NOT undo it.`,
                    okText: "Rewind anyway",
                    okButtonProps: {danger: true},
                    cancelText: "Cancel",
                    centered: true,
                    style: {borderRadius: 16},
                    onOk: run,
                })
            } else {
                run()
            }
        },
        [regenerate, setMessages, modal],
    )

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            {/* Themed confirm dialogs (rewind-past-a-tool) mount through this holder. */}
            {modalContextHolder}
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                    <Text type="secondary" className="!text-xs">
                        POST {trackApi(track)}
                    </Text>
                    <Text
                        type="secondary"
                        className="!text-[11px] font-mono"
                        copyable={{text: sessionId}}
                    >
                        session: {sessionId}
                    </Text>
                </div>
                <div className="flex items-center gap-2">
                    {appId && <ConfigBadge appId={appId} />}
                    {messages.length > 0 && (
                        <Text
                            type="secondary"
                            className="!text-xs cursor-pointer hover:underline"
                            onClick={() => setMessages([])}
                        >
                            Clear
                        </Text>
                    )}
                </div>
            </div>

            {error && (
                <Alert type="error" showIcon message="Stream error" description={error.message} />
            )}

            <div
                ref={dropContainerRef}
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-md border border-solid border-colorBorderSecondary p-3"
            >
                {messages.length === 0 && (
                    <div className="m-auto text-center text-sm text-colorTextTertiary">
                        Ask a question to start the agent conversation.
                    </div>
                )}
                {messages.map((message, index) => (
                    <AgentMessage
                        key={message.id}
                        message={message}
                        isStreaming={busy && index === messages.length - 1}
                        isLastMessage={index === messages.length - 1}
                        onRewind={handleRewind}
                        onApprovalResponse={addToolApprovalResponse}
                        onClientToolOutput={handleClientToolOutput}
                    />
                ))}
                {status === "submitted" && messages[messages.length - 1]?.role !== "assistant" && (
                    <Bubble placement="start" variant="borderless" loading content="" />
                )}
            </div>

            <Sender
                ref={senderRef}
                value={input}
                onChange={setInput}
                loading={busy}
                onSubmit={handleSubmit}
                onCancel={stop}
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
                    <Tooltip title="Attach files coming soon">
                        <Button
                            type="text"
                            size="small"
                            icon={<Paperclip size={16} />}
                            onClick={() => setAttachmentsOpen((open) => !open)}
                            disabled={
                                true /* TODO: re-enable once we can read the files into data: URLs at send time */
                            }
                        />
                    </Tooltip>
                }
                header={
                    // Own the collapse instead of `Sender.Header`: its `CSSMotion` hides via
                    // `display:none`, so the *enter* can't paint a height:0 baseline and jumps
                    // to full height (only leave animates). The grid 0fr→1fr trick animates
                    // symmetrically to the exact content height and never uses display:none, so
                    // `Attachments` stays mounted and drop-to-attach keeps working while closed.
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
                                    // Never auto-upload — keep the File and send it inline as a data: URL.
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

export default AgentChatConversation
