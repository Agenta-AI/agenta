import {memo, useEffect, useRef, useState} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {Actions, Bubble, FileCard, type ActionsProps} from "@ant-design/x"
import {
    ArrowUUpLeft,
    Brain,
    CaretRight,
    Copy,
    Robot,
    TreeStructure,
    User,
    XCircle,
} from "@phosphor-icons/react"
import type {FileUIPart, ReasoningUIPart, ToolUIPart, UIMessage} from "ai"
import {Avatar, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {openTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"

import {fileKind, filePartName} from "../assets/files"
import Markdown from "../assets/markdown"
import {getMessageTraceId, getMessageUsage, type MessageUsageMetrics} from "../assets/trace"

import ToolPart from "./ToolPart"

const {Text} = Typography

/** Cost / tokens / latency for a message, read from its trace (same data + component the
 * playground and trace drawer use). */
const TraceMetrics = ({traceId, usage}: {traceId: string; usage?: MessageUsageMetrics}) => {
    const summary = useAtomValue(traceDataSummaryAtomFamily(traceId))
    // Latency comes from the trace; tokens/cost come from the streamed message usage
    // (the agent-run trace summary doesn't surface them on the Pi/local path). Usage
    // wins where both exist so the figures match what the model actually reported.
    const metrics = {...summary.metrics, ...usage}
    return <ExecutionMetricsDisplay metrics={metrics} isLoading={summary.isPending} size="small" />
}

interface AgentMessageProps {
    message: UIMessage
    /** This is the last message AND the conversation is streaming — i.e. the one being
     * generated right now. Only it shows the loading state; settled turns never do. */
    isStreaming?: boolean
    onRewind: () => void
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
}

const isToolPart = (type: string) => type.startsWith("tool-") || type === "dynamic-tool"

/**
 * Collapsible reasoning ("thinking") block. While the model is reasoning (`state ===
 * "streaming"`) it auto-expands so the thoughts stream live; once done it auto-collapses to a
 * "Thought" toggle — click to re-expand. A manual toggle sticks (we stop auto-driving it).
 */
const ReasoningPart = ({text, streaming}: {text: string; streaming: boolean}) => {
    const [expanded, setExpanded] = useState(streaming)
    const userToggled = useRef(false)

    useEffect(() => {
        if (!userToggled.current) setExpanded(streaming)
    }, [streaming])

    return (
        <div className="flex flex-col">
            <button
                type="button"
                onClick={() => {
                    userToggled.current = true
                    setExpanded((e) => !e)
                }}
                aria-expanded={expanded}
                className="-ml-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs italic text-colorTextTertiary transition-colors hover:bg-[var(--ag-rgba-051729-04)] hover:text-colorTextSecondary"
            >
                <CaretRight
                    size={11}
                    weight="bold"
                    className={`transition-transform ${expanded ? "rotate-90" : ""}`}
                />
                <Brain size={12} />
                <span>{streaming ? "Thinking…" : "Thought"}</span>
            </button>
            {/* Smooth height collapse (grid 0fr→1fr) — same trick as the composer attachments,
                so the thought folds away instead of popping. Markdown-rendered + muted, no
                border (the reasoning reads as a quiet aside under the toggle, not a boxed card). */}
            <div
                className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                    expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
            >
                <div className="min-h-0 overflow-hidden">
                    <div className="mt-1 ml-5 text-colorTextTertiary">
                        <Markdown content={text} className="!text-xs" />
                    </div>
                </div>
            </div>
        </div>
    )
}

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
    isStreaming = false,
    onRewind,
    onApprovalResponse,
}: AgentMessageProps) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const isUser = message.role === "user"

    const traceId = getMessageTraceId(message)
    const usage = getMessageUsage(message)
    // A failed run (e.g. a quota error the runner swallowed into an empty turn) lands as an
    // error on the trace; read it so the bubble can render as a failure.
    const traceError = useAtomValue(traceDataSummaryAtomFamily(traceId ?? null)).error
    const fullText = message.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as {text: string}).text)
        .join("")
    const sources = message.parts.filter((p) => p.type === "source-url") as {
        type: "source-url"
        url: string
        title?: string
    }[]

    // "Answer" = anything the user is meant to read as a reply (text / tool / file / source).
    // Reasoning alone is NOT an answer — a turn that only thought hasn't responded.
    const hasAnswer = message.parts.some(
        (p) =>
            (p.type === "text" && (p as {text?: string}).text) ||
            isToolPart(p.type) ||
            p.type === "file" ||
            p.type === "source-url",
    )
    const hasReasoning = message.parts.some(
        (p) => p.type === "reasoning" && (p as {text?: string}).text,
    )
    const hasContent = hasAnswer || hasReasoning

    // A settled assistant turn (NOT the one being generated) with no answer — only a thought,
    // or nothing — means the model ended without responding. Surface it so the bubble doesn't
    // read as frozen/broken. Keyed on `isStreaming`, not the conversation-level `busy`, so
    // earlier answer-less turns don't all light up while a later turn streams.
    const noResponse = !isUser && !isStreaming && !hasAnswer
    // A settled no-answer turn whose trace recorded an error → render the bubble itself as a
    // failure (red), with the message inline — not a nested alert box.
    const isError = noResponse && !!traceError

    // Only the message being generated shows the loading state, and only until it has content.
    if (!isUser && isStreaming && !hasContent) {
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

    const defaultBody = (
        <div className="flex min-w-0 max-w-full flex-col gap-2">
            {message.parts.map((part, i) => {
                // Stable, globally-unique key per rendered part. The part index alone collides
                // across messages that React reconciles together (duplicate-key warnings); the
                // message id scopes it so each part is unique across the whole conversation.
                const partKey = `${message.id}-${i}`
                if (part.type === "text") {
                    const text = (part as {text: string}).text
                    if (!text) return null
                    // Render markdown for both roles so typed markdown displays properly.
                    return <Markdown key={partKey} content={text} />
                }
                if (part.type === "reasoning") {
                    const reasoning = part as ReasoningUIPart
                    if (!reasoning.text) return null
                    return (
                        <ReasoningPart
                            key={partKey}
                            text={reasoning.text}
                            streaming={reasoning.state === "streaming"}
                        />
                    )
                }
                if (isToolPart(part.type)) {
                    return (
                        <ToolPart
                            key={partKey}
                            part={part as ToolUIPart}
                            onApprovalResponse={onApprovalResponse}
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
                            key={partKey}
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
                            key={`${message.id}-source-${i}`}
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

            {noResponse && (
                <Text type="secondary" className="!text-xs italic">
                    No response — the agent ended its turn without answering.
                </Text>
            )}
        </div>
    )

    // Failed run: the whole bubble reads as the error (red), message inline — no nested box.
    const errorBody = (
        <div className="flex items-start gap-2">
            <XCircle size={16} weight="fill" className="mt-px shrink-0 text-colorError" />
            <div className="flex min-w-0 flex-col gap-0.5">
                <Text className="!text-xs !font-medium !text-colorError">The agent run failed</Text>
                <Text className="!text-xs break-words !text-colorErrorText">{traceError}</Text>
            </div>
        </div>
    )

    const body = isError ? errorBody : defaultBody

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
            {traceId && <TraceMetrics traceId={traceId} usage={usage} />}
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
    // and anchors to the bubble without consuming layout space. The row is a flex that
    // justifies the (width-capped) bubble to its side, so the opposite side keeps whitespace —
    // agent bubbles hug the left, user bubbles the right, neither spans the full column.
    return (
        <div
            className={`group relative flex items-start ${isUser ? "justify-end" : "justify-start"}`}
        >
            <Bubble<React.ReactNode>
                placement={isUser ? "end" : "start"}
                variant={isUser ? "filled" : "outlined"}
                avatar={avatarFor(isUser)}
                className="min-w-0 max-w-[85%]"
                classNames={{
                    content: `min-w-0 max-w-full overflow-hidden ${
                        isError ? "!border-colorErrorBorder !bg-[var(--ant-color-error-bg)]" : ""
                    }`,
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
