import {useMemo, useRef, useState} from "react"

import {useChat} from "@ai-sdk/react"
import {Bubble, Sender} from "@ant-design/x"
import {lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage} from "ai"
import {Alert, Modal, Tag, Typography} from "antd"

import {useAgConfigStatus} from "../assets/agConfig"
import {type AgentChatTrack, trackApi} from "../assets/constants"
import {messageText, sideEffectingToolsInRange} from "../assets/rewind"
import {createAgentChatTransport} from "../assets/transport"

import AgentMessage from "./AgentMessage"

const {Text} = Typography

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
const AgentChatConversation = ({track, appId}: {track: AgentChatTrack; appId: string | null}) => {
    const [input, setInput] = useState("")
    // Stable per-mount session id. The parent remounts per track (key={track}), so each
    // track gets its own session; it's passed to useChat as the chat id and travels to the
    // backend as `session_id`.
    const [sessionId] = useState(() => crypto.randomUUID())
    const senderRef = useRef<React.ComponentRef<typeof Sender>>(null)
    const transport = useMemo(() => createAgentChatTransport(track, appId), [track, appId])

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
        transport,
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
        onError: (err) => {
            console.error("[AgentChatSlice] useChat error:", err)
        },
    })

    const busy = status === "submitted" || status === "streaming"

    const handleSubmit = (text: string) => {
        const trimmed = text.trim()
        if (!trimmed || busy) return
        sendMessage({text: trimmed})
        setInput("")
    }

    /**
     * Rewind the conversation to `message` (truncate-in-place). A user turn drops it +
     * everything after and prefills the composer with its text to edit/resend; an assistant
     * turn re-runs via `regenerate`. Confirms first if the dropped range contains a tool that
     * already ran with a side effect (a rewind can't undo it).
     */
    const handleRewind = (message: UIMessage) => {
        if (busy) return
        const idx = messages.findIndex((m) => m.id === message.id)
        if (idx < 0) return
        const isUser = message.role === "user"
        // Everything from here on is dropped/re-run; already-executed side effects in this
        // tail (incl. the assistant turn's own tools, which regenerate re-fires) won't undo.
        const sideEffects = sideEffectingToolsInRange(messages.slice(idx))

        const run = () => {
            if (isUser) {
                setMessages(messages.slice(0, idx))
                setInput(messageText(message))
                // Focus the composer so the user can edit the restored text immediately.
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

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
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

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden rounded-md border border-solid border-colorBorderSecondary p-3">
                {messages.length === 0 && (
                    <div className="m-auto text-center text-sm text-colorTextTertiary">
                        Ask a question to start the agent conversation.
                    </div>
                )}
                {messages.map((message) => (
                    <AgentMessage
                        key={message.id}
                        message={message}
                        busy={busy}
                        onRewind={() => handleRewind(message)}
                        onApprovalResponse={addToolApprovalResponse}
                    />
                ))}
                {status === "submitted" && messages[messages.length - 1]?.role !== "assistant" && (
                    <Bubble placement="start" variant="outlined" loading content="" />
                )}
            </div>

            <Sender
                ref={senderRef}
                value={input}
                onChange={setInput}
                loading={busy}
                onSubmit={handleSubmit}
                onCancel={stop}
                placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"
            />
        </div>
    )
}

export default AgentChatConversation
