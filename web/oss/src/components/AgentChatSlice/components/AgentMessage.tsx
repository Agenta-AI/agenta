import {memo, useEffect, useRef, useState} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {Actions, Bubble, FileCard, type ActionsProps} from "@ant-design/x"
import {
    ArrowUUpLeft,
    Brain,
    CaretRight,
    Check,
    Clock,
    Copy,
    Robot,
    TreeStructure,
    User,
    XCircle,
} from "@phosphor-icons/react"
import type {FileUIPart, ReasoningUIPart, ToolUIPart, UIMessage} from "ai"
import {Avatar} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {openTraceDrawerAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"

import {fileKind, filePartName} from "../assets/files"
import Markdown from "../assets/markdown"
import {
    getMessageRunError,
    getMessageTraceId,
    getMessageUsage,
    type MessageUsageMetrics,
} from "../assets/trace"
import {chatPanelMaximizedAtom} from "../state/panelLayout"
import {messageCreatedAtAtomFamily, nowTickAtom, timeAgo} from "../state/sessions"

import {ClientToolPart, isClientToolPart, type ClientToolOutputHandler} from "./clientTools"
import ToolActivity from "./ToolActivity"

/** A trace span's `start_time` (ISO string / epoch) → ms, or undefined if absent/unparseable. */
const parseTraceTime = (value: unknown): number | undefined => {
    if (value == null) return undefined
    const ms = new Date(value as string | number).getTime()
    return Number.isFinite(ms) ? ms : undefined
}

/** Relative "just now / 5m ago / 2h ago" message stamp; subscribes to the minute tick so it stays
 * fresh, and shows the exact date/time on hover. */
const MessageTimestamp = ({createdAt}: {createdAt: number}) => {
    useAtomValue(nowTickAtom)
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span className="flex items-center gap-1 whitespace-nowrap px-1 text-[11px] text-colorTextTertiary">
                        <Clock size={12} />
                        {timeAgo(createdAt)}
                    </span>
                }
            />
            <TooltipContent>{new Date(createdAt).toLocaleString()}</TooltipContent>
        </Tooltip>
    )
}

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
    /** This is the last message in the conversation. A parked client tool only lands on the last
     * turn, so the unknown-client-tool fallback only arms there (see `isClientToolPart`). */
    isLastMessage?: boolean
    /** Stable across renders (parent passes a `useCallback`'d handler) so the `memo()` below
     * isn't defeated — the message to rewind to is passed in, not closed over per render. */
    onRewind: (message: UIMessage) => void
    /** Settle a parked client tool (#4920) — the dispatcher calls this from a widget. */
    onClientToolOutput: ClientToolOutputHandler
    /** The previous turn was also an empty (content-less) assistant turn. Used to collapse a
     * run of "no response" bubbles down to the first one. */
    precededByEmptyAssistant?: boolean
    /** The turn's trace id for a USER message (its paired assistant's trace) — lets the user turn
     * borrow the run's real start time so it dates from the trace, not this browser's first-seen. */
    turnTraceId?: string
}

const isToolPart = (type: string) => type.startsWith("tool-") || type === "dynamic-tool"

/**
 * Collapsible reasoning ("thinking") block. While the model is reasoning (`state ===
 * "streaming"`) it auto-expands so the thoughts stream live; once done it auto-collapses to a
 * "Thought" toggle — click to re-expand. A manual toggle sticks (we stop auto-driving it).
 */
const ReasoningPart = ({text, streaming}: {text: string; streaming: boolean}) => {
    // Auto-expand only while the thought streams live, then collapse to the "Thought" toggle when
    // done — in BOTH modes. The full reasoning lives in the Turn Inspector, so the inline step log
    // stays minimized by default. A manual toggle sticks (we stop auto-driving it).
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
                className="-ml-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1 py-0.5 text-xs italic text-colorTextSecondary transition-colors hover:bg-colorFillQuaternary hover:text-colorText"
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

/**
 * Failed-run body: the icon + "The agent run failed" + the reason. The reason is clamped to a few
 * lines by default so a long message (or a stacktrace that slipped past parsing) can't drown the
 * chat; when it's long, a "Show more" toggle expands it into a scrollable, whitespace-preserving
 * block so it stays readable.
 */
const RunErrorBody = ({text}: {text: string}) => {
    const [expanded, setExpanded] = useState(false)
    const isLong = text.length > 220 || text.includes("\n")

    return (
        <div className="flex items-start gap-2 rounded-md bg-[var(--ant-color-error-bg)] px-3 py-2">
            <XCircle size={16} weight="fill" className="mt-px shrink-0 text-colorError" />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="!text-xs !font-medium !text-colorError">The agent run failed</span>
                {expanded ? (
                    <pre className="m-0 max-h-60 w-full overflow-auto whitespace-pre-wrap break-words bg-transparent p-0 font-mono text-[11px] !text-colorErrorText">
                        {text}
                    </pre>
                ) : (
                    <span
                        className="line-clamp-3 !text-xs break-words !text-colorErrorText"
                        title={isLong ? text : undefined}
                    >
                        {text}
                    </span>
                )}
                {isLong && (
                    <button
                        type="button"
                        onClick={() => setExpanded((e) => !e)}
                        aria-expanded={expanded}
                        className="-ml-1 cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[11px] font-medium text-colorError transition-colors hover:bg-[var(--ant-color-error-bg)]"
                    >
                        {expanded ? "Show less" : "Show more"}
                    </button>
                )}
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
    isLastMessage = false,
    onRewind,
    onClientToolOutput,
    precededByEmptyAssistant = false,
    turnTraceId,
}: AgentMessageProps) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const isUser = message.role === "user"
    // Build vs Chat: Build (config panel open, not maximized) shows the full step log — per-tool
    // input/output/error + expanded reasoning; Chat keeps the calm collapsed summary.
    const detailed = !useAtomValue(chatPanelMaximizedAtom)
    const [copied, setCopied] = useState(false)
    const copyResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const traceId = getMessageTraceId(message)
    const usage = getMessageUsage(message)
    // Client-stamped first-seen time — only a fallback: it back-dates history to load time. The
    // trace's real start time (own trace, or the paired turn trace for a user turn) is authoritative.
    const createdAt = useAtomValue(messageCreatedAtAtomFamily(message.id))
    // A failed run (e.g. a quota error the runner swallowed into an empty turn) lands as an
    // error on the message's OWN trace; read it so the bubble can render as a failure.
    const ownSummary = useAtomValue(traceDataSummaryAtomFamily(traceId ?? null))
    const traceError = ownSummary.error
    // Timestamp uses the run's real start. An assistant turn already has `ownSummary`; only a user
    // turn needs the paired turn's trace, so read that second (no-op when null) atom only then.
    const pairedSummary = useAtomValue(
        traceDataSummaryAtomFamily(!traceId && turnTraceId ? turnTraceId : null),
    )
    const timeSummary = traceId ? ownSummary : pairedSummary
    const messageTime = parseTraceTime(timeSummary.rootSpan?.start_time) ?? createdAt
    // A failure can reach us two ways: recorded on the trace (backend), or stamped onto the turn
    // FE-side from the useChat stream error (AgentChatPanel). `errorText` is derived below, once
    // we know whether the turn produced an answer.
    const runError = getMessageRunError(message)
    const fullText = message.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as {text: string}).text)
        .join("")
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(fullText)
            setCopied(true)
            if (copyResetTimeoutRef.current) clearTimeout(copyResetTimeoutRef.current)
            copyResetTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
        } catch {
            setCopied(false)
        }
    }
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

    // A trace-leaf error means a model/tool call failed. When the turn still produced an answer,
    // the agent recovered from it — that failure belongs inline in ToolActivity ("· N failed"),
    // NOT as a run failure. So trust `traceError` only on an answer-less turn (the swallowed
    // quota/model error it was written for). A stream death (`runError`) is a real run failure
    // even with partial output, so it always counts.
    const errorText = noResponse ? traceError || runError : runError
    // Surface a settled-turn error even when the model emitted partial output before the stream
    // died. (`isError` stays answer-less-only so the *whole* bubble only turns red when there's
    // nothing else to show.)
    const showError = !isStreaming && !!errorText
    // A settled no-answer turn whose trace recorded an error → render the bubble itself as a
    // failure (red), with the message inline — not a nested alert box.
    const isError = noResponse && showError

    // #3: collapse a run of empty "no response" turns to just the first. A turn with ANY content
    // (answer or reasoning) and any error turn (isError, which shows the real failure) always
    // render; only a truly-empty, non-error turn that follows another empty turn is hidden.
    if (noResponse && !showError && !hasContent && precededByEmptyAssistant) return null

    // Only the message being generated shows the loading state, and only until it has content.
    if (!isUser && isStreaming && !hasContent) {
        return (
            <Bubble
                placement="start"
                variant="borderless"
                avatar={avatarFor(false)}
                loading
                content=""
            />
        )
    }

    // Tools can be interleaved with text / reasoning, so fold only *consecutive* tool parts
    // into one ToolActivity group (a run of calls reads as a single "Used N tools" line).
    type RenderItem =
        | {kind: "part"; part: UIMessage["parts"][number]; index: number}
        | {kind: "tools"; parts: ToolUIPart[]; index: number}
        | {kind: "clientTool"; part: ToolUIPart; index: number}
    // A HITL-approved tool's part LINGERS in `approval-responded` (a perpetual spinner, no output):
    // the cold-replay runner re-issues the approved call under a FRESH id, so its execution output
    // lands on a SEPARATE sibling part. Drop the answered gate once its executed sibling exists (same
    // tool + same input), so the turn shows the single completed call with its output — not a stuck
    // spinner beside a duplicate. Until the execution settles, the gate stays (it is genuinely
    // in-flight).
    const toolIdentity = (p: ToolUIPart): string => {
        let inputKey = ""
        try {
            inputKey = JSON.stringify((p as {input?: unknown}).input ?? null)
        } catch {
            inputKey = ""
        }
        return `${p.type}::${inputKey}`
    }
    const executedToolIdentities = new Set(
        message.parts
            .filter(
                (p) =>
                    isToolPart(p.type) &&
                    ((p as ToolUIPart).state === "output-available" ||
                        (p as ToolUIPart).state === "output-error"),
            )
            .map((p) => toolIdentity(p as ToolUIPart)),
    )
    const isSupersededGate = (p: ToolUIPart): boolean =>
        p.state === "approval-responded" && executedToolIdentities.has(toolIdentity(p))

    const renderItems: RenderItem[] = []
    message.parts.forEach((part, i) => {
        if (isToolPart(part.type)) {
            // The answered gate whose execution already landed on a sibling part — drop it so the
            // turn doesn't show a stuck approval spinner beside the real, completed call.
            if (isSupersededGate(part as ToolUIPart)) return
            // A browser-fulfilled client tool (#4920) renders as its own widget/chip, NOT folded
            // into the "Used N tools" group — so it breaks any current tool run.
            if (isClientToolPart(part as ToolUIPart, {isStreaming, isLastMessage})) {
                renderItems.push({kind: "clientTool", part: part as ToolUIPart, index: i})
                return
            }
            const last = renderItems[renderItems.length - 1]
            if (last && last.kind === "tools") last.parts.push(part as ToolUIPart)
            else renderItems.push({kind: "tools", parts: [part as ToolUIPart], index: i})
            return
        }
        renderItems.push({kind: "part", part, index: i})
    })
    // The tool group's "View full trace" opens the same per-turn trace the action row does.
    const onViewTrace = traceId ? () => openTraceDrawer({traceId}) : undefined

    const renderLeafPart = (part: UIMessage["parts"][number], i: number) => {
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
    }

    const defaultBody = (
        <div className="flex min-w-0 max-w-full flex-col gap-2">
            {renderItems.map((item) => {
                if (item.kind === "tools") {
                    return (
                        <ToolActivity
                            key={`${message.id}-tools-${item.index}`}
                            parts={item.parts}
                            isStreaming={isStreaming}
                            detailed={detailed}
                            onViewTrace={onViewTrace}
                        />
                    )
                }
                if (item.kind === "clientTool") {
                    return (
                        <ClientToolPart
                            key={`${message.id}-clienttool-${item.part.toolCallId || item.index}`}
                            part={item.part}
                            onOutput={onClientToolOutput}
                        />
                    )
                }
                return renderLeafPart(item.part, item.index)
            })}

            {sources.length > 0 && (
                <div className="flex flex-col gap-0.5 pt-1">
                    <span className="!text-[11px] uppercase tracking-wide text-muted-foreground">
                        Sources
                    </span>
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
                <span className="!text-xs italic text-muted-foreground">
                    No response — the agent ended its turn without answering.
                </span>
            )}
        </div>
    )

    // Failed run: the whole bubble reads as the error (red), message inline — no nested box.
    // RunErrorBody truncates a long reason so it can't drown the chat (expand to read it all).
    const errorBody = <RunErrorBody text={errorText || "The agent run failed."} />

    // Partial output then failure: show the content AND the error. Answer-less failure: the
    // whole bubble is the error. Otherwise: just the content.
    const body =
        showError && !isError ? (
            <div className="flex min-w-0 max-w-full flex-col gap-2">
                {defaultBody}
                {errorBody}
            </div>
        ) : isError ? (
            errorBody
        ) : (
            defaultBody
        )

    // Control toolbar — an X `Actions` row that sits in a reserved lane BELOW the bubble (the
    // `pb-10` on the row), so it never overlays the last content line and never reaches the next
    // turn. The lane is always present (stable height), so revealing it only fades opacity — no
    // layout shift either way (the scroll engineering is sensitive to hover-driven reflow).
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
        onItemClick: () => onRewind(message),
    }

    const timestamp = messageTime ? <MessageTimestamp createdAt={messageTime} /> : null

    const toolbar = isUser ? (
        <>
            {timestamp}
            <Actions variant="borderless" items={[rewindAction]} />
        </>
    ) : (
        <>
            {timestamp}
            {/* Show run metrics (tokens/cost, + latency when traced). Usage is stamped on the
                settled message itself, so surface it even on the no-trace playground path instead
                of leaving the turn with no data. */}
            {traceId ? (
                <TraceMetrics traceId={traceId} usage={usage} />
            ) : usage ? (
                <ExecutionMetricsDisplay metrics={usage} size="small" />
            ) : null}
            <Actions
                variant="borderless"
                items={[
                    {
                        key: "copy",
                        label: copied ? "Copied" : "Copy",
                        icon: copied ? <Check size={14} /> : <Copy size={14} />,
                        onItemClick: handleCopy,
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

    // `group relative` → the toolbar reveals on hover/focus of the whole message row and anchors
    // to the reserved lane (`pb-7`) at the row's bottom. The row is a flex that justifies the
    // (width-capped) bubble to its side, so the opposite side keeps whitespace — agent bubbles hug
    // the left, user bubbles the right, neither spans the full column.
    return (
        <div
            className={`group relative flex items-start pb-10 ${isUser ? "justify-end" : "justify-start"}`}
        >
            <Bubble<React.ReactNode>
                placement={isUser ? "end" : "start"}
                // Borderless assistant turns: content sits on the panel bg with just the avatar and
                // spacing, so tool cards aren't wrapped in an extra outline. User stays filled.
                variant={isUser ? "filled" : "borderless"}
                avatar={avatarFor(isUser)}
                className="min-w-0 max-w-[85%]"
                classNames={{
                    // Error styling is a self-contained callout in RunErrorBody now, not painted on
                    // the (borderless) bubble content — otherwise it bleeds edge-to-edge with no pad.
                    // The user turn reads as "mine" via a soft accent-tinted card; the agent turn
                    // stays borderless on the canvas.
                    content: isUser
                        ? "min-w-0 max-w-full overflow-hidden !border !border-solid !border-[var(--ag-user-bubble-border)] !bg-[var(--ag-user-bubble-bg)]"
                        : "min-w-0 max-w-full overflow-hidden",
                    body: "min-w-0 max-w-full overflow-hidden",
                }}
                content={body}
            />
            <div
                className={`absolute bottom-0 z-10 flex items-center gap-1 rounded-md border border-solid border-colorBorderSecondary bg-colorBgElevated px-1 shadow-sm ${
                    isUser ? "right-2" : "left-10"
                } ${toolbarReveal}`}
            >
                {toolbar}
            </div>
        </div>
    )
}

export default memo(AgentMessage)
