import {useMemo, useState} from "react"

import {useChat} from "@ai-sdk/react"
import {Bubble, Sender} from "@ant-design/x"
import {Eye, EyeSlash} from "@phosphor-icons/react"
import {lastAssistantMessageIsCompleteWithApprovalResponses} from "ai"
import {Alert, Button, Tag, Typography} from "antd"

import {useAgConfigStatus} from "../assets/agConfig"
import {type AgentChatTrack, trackApi} from "../assets/constants"
import Markdown from "../assets/markdown"
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
    const [showPreview, setShowPreview] = useState(false)
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

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <Text type="secondary" className="!text-xs">
                    POST {trackApi(track)}
                </Text>
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
                {messages.map((message, i) => (
                    <AgentMessage
                        key={message.id}
                        message={message}
                        isLast={i === messages.length - 1}
                        busy={busy}
                        onRegenerate={() => regenerate()}
                        onApprovalResponse={addToolApprovalResponse}
                    />
                ))}
                {status === "submitted" && messages[messages.length - 1]?.role !== "assistant" && (
                    <Bubble placement="start" variant="outlined" loading content="" />
                )}
            </div>

            <div className="flex flex-col gap-2">
                {showPreview && (
                    <div className="max-h-44 overflow-y-auto rounded-md border border-solid border-colorBorderSecondary p-3">
                        {input.trim() ? (
                            <Markdown content={input} />
                        ) : (
                            <Text type="secondary" className="!text-xs">
                                Start typing to preview your markdown…
                            </Text>
                        )}
                    </div>
                )}
                <div className="flex justify-end">
                    <Button
                        size="small"
                        type="text"
                        className="!text-xs"
                        icon={showPreview ? <EyeSlash size={14} /> : <Eye size={14} />}
                        onClick={() => setShowPreview((v) => !v)}
                    >
                        {showPreview ? "Hide preview" : "Markdown preview"}
                    </Button>
                </div>
                <Sender
                    value={input}
                    onChange={setInput}
                    loading={busy}
                    onSubmit={handleSubmit}
                    onCancel={stop}
                    placeholder="Ask the agent… (Enter to send, Shift+Enter for newline)"
                />
            </div>
        </div>
    )
}

export default AgentChatConversation
