import {memo} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {Actions, Bubble, FileCard, type ActionsProps} from "@ant-design/x"
import {ArrowUUpLeft, Copy, Robot, TreeStructure, User} from "@phosphor-icons/react"
import type {FileUIPart, ToolUIPart, UIMessage} from "ai"
import {Avatar, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {openTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"

import {fileKind, filePartName} from "../assets/files"
import Markdown from "../assets/markdown"
import {getMessageTraceId} from "../assets/trace"

import ToolPart from "./ToolPart"

const {Text} = Typography

/** Cost / tokens / latency for a message, read from its trace (same data + component the
 * playground and trace drawer use). */
const TraceMetrics = ({traceId}: {traceId: string}) => {
    const summary = useAtomValue(traceDataSummaryAtomFamily(traceId))
    return (
        <ExecutionMetricsDisplay
            metrics={summary.metrics}
            isLoading={summary.isPending}
            size="small"
        />
    )
}

interface AgentMessageProps {
    message: UIMessage
    busy: boolean
    onRewind: () => void
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
const AgentMessage = ({message, busy, onRewind, onApprovalResponse}: AgentMessageProps) => {
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
            p.type === "file" ||
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
                // Multi-modality: render attachments (sent by the user or returned by the
                // agent) as X `FileCard`s — images preview inline, other kinds show a typed
                // file chip with a download link.
                if (part.type === "file") {
                    const file = part as FileUIPart
                    const kind = fileKind(file.mediaType)
                    return (
                        <FileCard
                            key={i}
                            name={filePartName(file)}
                            type={kind}
                            src={file.url}
                            size="small"
                            className="max-w-full"
                            description={
                                kind === "file" ? (
                                    <a
                                        href={file.url}
                                        download={filePartName(file)}
                                        className="text-xs text-colorPrimary"
                                    >
                                        {file.mediaType}
                                    </a>
                                ) : undefined
                            }
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

    // Control toolbar — an X `Actions` row that FLOATS over the bubble's bottom edge. It is
    // absolutely positioned (out of flow), so it adds no height: bubbles sit tight with no
    // reserved lane, and revealing it only fades opacity — no layout shift either way.
    // `pointer-events-none` while hidden keeps the invisible buttons unclickable. `Actions`
    // items carry no `disabled`, so the busy guard lives in the handlers: `onRewind` →
    // `handleRewind` early-returns while a stream is in flight (copy / view-trace are always
    // safe). The item `label` renders as the hover tooltip.
    const toolbarReveal =
        "opacity-0 transition-opacity duration-150 pointer-events-none " +
        "group-hover:opacity-100 group-hover:pointer-events-auto " +
        "focus-within:opacity-100 focus-within:pointer-events-auto"
    const rewindAction: ActionsProps["items"][number] = {
        key: "rewind",
        label: isUser
            ? "Rewind here — edit and re-run the conversation from this message"
            : "Rewind here — re-run this turn",
        icon: <ArrowUUpLeft size={14} />,
        onItemClick: () => onRewind(),
    }

    const toolbar = isUser ? (
        <Actions variant="borderless" items={[rewindAction]} />
    ) : (
        <>
            {traceId && <TraceMetrics traceId={traceId} />}
            <Actions
                variant="borderless"
                items={[
                    {
                        key: "copy",
                        label: "Copy",
                        icon: <Copy size={14} />,
                        onItemClick: () => navigator.clipboard.writeText(fullText),
                    },
                    rewindAction,
                    ...(traceId
                        ? [
                              {
                                  key: "trace",
                                  label: "View trace",
                                  icon: <TreeStructure size={14} />,
                                  onItemClick: () => openTraceDrawer({traceId}),
                              },
                          ]
                        : []),
                ]}
            />
        </>
    )

    // `group relative` → the floating toolbar reveals on hover/focus of the whole message row
    // and anchors to the bubble without consuming layout space.
    return (
        <div className="group relative">
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
            />
            <div
                className={`absolute top-full z-10 flex -translate-y-1/2 items-center gap-1 rounded-md border border-solid border-colorBorderSecondary bg-colorBgElevated px-1 shadow-sm ${
                    isUser ? "right-2" : "left-10"
                } ${toolbarReveal}`}
            >
                {toolbar}
            </div>
        </div>
    )
}

export default memo(AgentMessage)
