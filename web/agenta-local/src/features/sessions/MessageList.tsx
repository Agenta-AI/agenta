import {RedoOutlined, RobotOutlined, UserOutlined, WarningOutlined} from "@ant-design/icons"
import {Button, Tag} from "antd"

import type {Message} from "@/lib/api/schemas"

export interface LiveAttempt {
    input: string
    output: string
    status: "streaming" | "failed" | "cancelled" | "interrupted" | "denied"
    error?: string
}

const messageText = (message: Message) =>
    typeof message.content.text === "string" ? message.content.text : ""

export const MessageList = ({
    messages,
    attempt,
    retry,
}: {
    messages: Message[]
    attempt: LiveAttempt | null
    retry: () => void
}) => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user")
    const showAttemptInput = Boolean(
        attempt && (!lastUser || messageText(lastUser) !== attempt.input),
    )
    return (
        <div className="message-list" aria-live="polite">
            {messages.map((message) => (
                <article key={message.id} className={`message-row ${message.role}`}>
                    <div className="message-avatar">
                        {message.role === "user" ? <UserOutlined /> : <RobotOutlined />}
                    </div>
                    <div className="message-content">
                        <strong>{message.role === "user" ? "You" : "Agent"}</strong>
                        <p>{messageText(message)}</p>
                    </div>
                </article>
            ))}
            {attempt && showAttemptInput ? (
                <article className="message-row user pending">
                    <div className="message-avatar">
                        <UserOutlined />
                    </div>
                    <div className="message-content">
                        <strong>You</strong>
                        <p>{attempt.input}</p>
                    </div>
                </article>
            ) : null}
            {attempt ? (
                <article className={`message-row assistant ${attempt.status}`}>
                    <div className="message-avatar">
                        <RobotOutlined />
                    </div>
                    <div className="message-content">
                        <strong>Agent</strong>
                        {attempt.output ? (
                            <p>{attempt.output}</p>
                        ) : attempt.status === "streaming" ? (
                            <span className="typing-dots">
                                <i />
                                <i />
                                <i />
                            </span>
                        ) : null}
                        {attempt.status !== "streaming" ? (
                            <div className="turn-terminal">
                                <Tag
                                    icon={<WarningOutlined />}
                                    color={attempt.status === "cancelled" ? "default" : "error"}
                                >
                                    {attempt.status}
                                </Tag>
                                <span>{attempt.error}</span>
                                <Button size="small" icon={<RedoOutlined />} onClick={retry}>
                                    Retry
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </article>
            ) : null}
        </div>
    )
}
