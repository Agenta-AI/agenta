import {memo} from "react"

import {Bubble} from "@ant-design/x"
import {ArrowsClockwise, Copy, Robot, TreeStructure, User} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {Avatar, Button, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"

import {openTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"

import Markdown from "../assets/markdown"
import {getMessageTraceId} from "../assets/trace"

import ToolPart from "./ToolPart"

const {Text} = Typography

interface AgentMessageProps {
    message: UIMessage
    isLast: boolean
    busy: boolean
    onRegenerate: () => void
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
}

const isToolPart = (type: string) => type.startsWith("tool-") || type === "dynamic-tool"

const avatarFor = (isUser: boolean) => (
    <Avatar size="small" icon={isUser ? <User size={16} /> : <Robot size={16} />} />
)

/**
 * Read-only renderer for one agent conversation message, rendered inside an Ant Design X
 * `Bubble`. Walks `message.parts` in order (text → markdown, reasoning, tool calls +
 * approvals, sources) for the bubble body, and puts the per-message action row in the
 * footer. While an assistant message has no content yet, the bubble shows the loading state.
 */
const AgentMessage = ({
    message,
    isLast,
    busy,
    onRegenerate,
    onApprovalResponse,
}: AgentMessageProps) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const isUser = message.role === "user"

    const traceId = getMessageTraceId(message)
    const fullText = message.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as {text: string}).text)
        .join("")
    const sources = message.parts.filter((p) => p.type === "source-url") as {
        type: "source-url"
        url: string
        title?: string
    }[]

    const hasContent = message.parts.some(
        (p) =>
            (p.type === "text" && (p as {text?: string}).text) ||
            (p.type === "reasoning" && (p as {text?: string}).text) ||
            isToolPart(p.type) ||
            p.type === "source-url",
    )

    // Assistant turn that hasn't produced anything yet → show the bubble's loading state.
    if (!isUser && !hasContent) {
        return (
            <Bubble
                placement="start"
                variant="outlined"
                avatar={avatarFor(false)}
                loading
                content=""
            />
        )
    }

    const body = (
        <div className="flex min-w-0 max-w-full flex-col gap-1">
            {message.parts.map((part, i) => {
                if (part.type === "text") {
                    const text = (part as {text: string}).text
                    if (!text) return null
                    // Render markdown for both roles so typed markdown displays properly.
                    return <Markdown key={i} content={text} />
                }
                if (part.type === "reasoning") {
                    const text = (part as {text: string}).text
                    if (!text) return null
                    return (
                        <div
                            key={i}
                            className="whitespace-pre-wrap border-l-2 border-solid border-colorBorderSecondary pl-2 text-xs italic text-colorTextTertiary"
                        >
                            {text}
                        </div>
                    )
                }
                if (isToolPart(part.type)) {
                    return (
                        <ToolPart
                            key={i}
                            part={part as ToolUIPart}
                            onApprovalResponse={onApprovalResponse}
                            disabled={busy}
                        />
                    )
                }
                return null
            })}

            {sources.length > 0 && (
                <div className="flex flex-col gap-0.5 pt-1">
                    <Text type="secondary" className="!text-[11px] uppercase tracking-wide">
                        Sources
                    </Text>
                    {sources.map((s, i) => (
                        <a
                            key={i}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-xs text-colorPrimary"
                        >
                            {s.title || s.url}
                        </a>
                    ))}
                </div>
            )}
        </div>
    )

    const footer = isUser ? undefined : (
        <div className="flex items-center gap-1">
            <Tooltip title="Copy">
                <Button
                    type="text"
                    size="small"
                    icon={<Copy size={14} />}
                    onClick={() => navigator.clipboard.writeText(fullText)}
                />
            </Tooltip>
            {isLast && (
                <Tooltip title="Retry">
                    <Button
                        type="text"
                        size="small"
                        disabled={busy}
                        icon={<ArrowsClockwise size={14} />}
                        onClick={onRegenerate}
                    />
                </Tooltip>
            )}
            {traceId && (
                <Tooltip title="View trace">
                    <Button
                        type="text"
                        size="small"
                        icon={<TreeStructure size={14} />}
                        onClick={() => openTraceDrawer({traceId})}
                    />
                </Tooltip>
            )}
        </div>
    )

    return (
        <Bubble<React.ReactNode>
            placement={isUser ? "end" : "start"}
            variant={isUser ? "filled" : "outlined"}
            avatar={avatarFor(isUser)}
            className="min-w-0 max-w-full"
            classNames={{
                content: "min-w-0 max-w-full overflow-hidden",
                body: "min-w-0 max-w-full overflow-hidden",
            }}
            content={body}
            footer={footer}
        />
    )
}

export default memo(AgentMessage)
