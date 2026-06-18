import {useMemo, useState} from "react"

import {useChat} from "@ai-sdk/react"
import {Bubble, Sender} from "@ant-design/x"
import {lastAssistantMessageIsCompleteWithApprovalResponses} from "ai"
import {Alert, Tag, Typography} from "antd"

import {useAgConfigStatus} from "../assets/agConfig"
import {agentChatApi} from "../assets/constants"
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
 * The `useChat` conversation, rendered with Ant Design X (`Bubble` per message + `Sender`
 * composer). Posts the RFC `POST /messages` envelope; the response is a v6 UI Message
 * Stream. When `appId` is set (the page is app-scoped), the transport sends the real
 * `references` + agent config resolved from that app's latest revision; otherwise a stub.
 */
const AgentChatConversation = ({appId}: {appId: string | null}) => {
    const [input, setInput] = useState("")
    // Stable per-mount session id, passed to useChat as the chat id and sent to the backend
    // as `session_id` (the server echoes it back on the stream's `start` part).
    const [sessionId] = useState(() => crypto.randomUUID())
    const transport = useMemo(() => createAgentChatTransport(appId), [appId])

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

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                    <Text type="secondary" className="!text-xs">
                        POST {agentChatApi}
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

            <Sender
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
