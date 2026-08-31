import {memo, useEffect, useMemo, useState} from "react"

import {
    getMessageRunError,
    getMessageRunErrorCode,
    getMessageTraceId,
    getMessageUsage,
} from "@agenta/chat/assets"
import {attachmentIdForPart, filePartName} from "@agenta/chat/assets"
import {
    ClientToolPart,
    isClientToolPart,
    type ClientToolOutputHandler,
} from "@agenta/chat/clientTools"
import {
    AttachmentCard,
    AttachmentCardGrid,
    CollapsibleMessageBody,
    StartupActivity,
    TurnFooter,
} from "@agenta/chat/components"
import {isToolPart, toolIdentity} from "@agenta/chat/model"
import {
    errorKey,
    expandedValueAtomFamily,
    messageBodyKey,
    reasoningKey,
    setExpandedAtom,
    useStartupPhase,
} from "@agenta/chat/state"
import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {AgentChatAvatar} from "@agenta/entity-ui/agent"
import {useDriveArtifactId} from "@agenta/entity-ui/drive"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {buildRenderMap} from "@agenta/playground"
import {openProviderDrawerRequestAtom} from "@agenta/shared/state"
import {hasPriorElicitationDegradation} from "@agenta/shared/utils"
import {
    ChatBubble,
    ChatBubbleAvatar,
    turnRowClass,
    turnToolbarClass,
    turnToolbarRevealClass,
    userBubbleContentClass,
} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {Brain, CaretRight, Robot, User, XCircle} from "@phosphor-icons/react"
import type {FileUIPart, ReasoningUIPart, ToolUIPart, UIMessage} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {useAttachmentMediaSrc} from "../assets/attachmentMedia"

import StreamingMarkdown from "./StreamingMarkdown"
import ToolActivity from "./ToolActivity"

interface AgentMessageProps {
    message: UIMessage
    sessionId: string
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
    /** Re-run this failed turn — the same regenerate wiring as the Stopped → Resend affordance.
     * Stable across renders (the message to retry is passed in, not closed over); the parent
     * passes it only on the last turn while a retry can actually run, so it gates position. */
    onRetry?: (messageId: string) => void
}

/**
 * Collapsible reasoning ("thinking") block. While the model is reasoning (`state ===
 * "streaming"`) it auto-expands so the thoughts stream live; once done it auto-collapses to a
 * "Thought" toggle — click to re-expand. A manual toggle sticks (we stop auto-driving it).
 */
const ReasoningPart = ({
    text,
    streaming,
    stateKey,
    urgent,
}: {
    text: string
    streaming: boolean
    stateKey: string
    /** Something already renders below this block, so it must not keep typing. */
    urgent?: boolean
}) => {
    // Auto-expand while the thought streams live, then collapse to the "Thought" toggle when done. A
    // manual toggle sticks. State is keyed + persisted (expandState) so it survives a Virtuoso unmount
    // when the row scrolls off: `undefined` follows `streaming`, a set value wins.
    const stored = useAtomValue(expandedValueAtomFamily(stateKey))
    const setExpanded = useSetAtom(setExpandedAtom)
    const expanded = stored ?? streaming

    return (
        <div className="flex flex-col">
            <button
                type="button"
                onClick={() => setExpanded({key: stateKey, value: !expanded})}
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
                        <StreamingMarkdown
                            content={text}
                            className="!text-xs"
                            streaming={streaming}
                            urgent={urgent}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

/** Failure classes the user can clear themselves by adding their own provider key. */
const STARTER_CREDIT_CODES = new Set([
    "starter_credits_exhausted",
    "starter_credits_program_paused",
])

/** Transient failure classes where the honest advice is simply to run the turn again. */
const RETRYABLE_CODES = new Set([
    "credential_delivery_failed",
    "starter_credits_unavailable",
    "rate_limited",
])

/** The ONE rule driving both the clamp and the toggle — they can't disagree and hide text (#5350). */
const isBigError = (text: string) => text.length > 240 || text.split("\n").length > 4

/**
 * Failed-run body: the icon + "The agent run failed" + the reason. An everyday reason shows in
 * full; a big one (stacktrace) clamps behind a "Show more" that opens a scrollable block, so it
 * can't drown the chat.
 */
export const RunErrorBody = ({
    text,
    stateKey,
    code,
    onRetry,
}: {
    text: string
    stateKey: string
    /** The runner's failure class, when the turn carried one (`data-agent-error`'s `code`). */
    code?: string
    /** Re-run the failed turn; offered only for the transient classes in RETRYABLE_CODES. */
    onRetry?: () => void
}) => {
    const stored = useAtomValue(expandedValueAtomFamily(stateKey))
    const setExpanded = useSetAtom(setExpandedAtom)
    const requestProviderDrawer = useSetAtom(openProviderDrawerRequestAtom)
    const expanded = stored ?? false
    const big = isBigError(text)
    const offerOwnKey = code ? STARTER_CREDIT_CODES.has(code) : false
    const offerRetry = !!onRetry && !!code && RETRYABLE_CODES.has(code)

    return (
        <div className="flex items-start gap-2 rounded-xl bg-[var(--ant-color-error-bg)] px-4 py-3">
            <XCircle size={16} weight="fill" className="mt-px shrink-0 text-colorError" />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="text-xs font-medium text-colorError">The agent run failed</span>
                {big && expanded ? (
                    <pre className="m-0 max-h-60 w-full overflow-auto whitespace-pre-wrap break-words bg-transparent p-0 font-mono text-xs !text-colorErrorText">
                        {text}
                    </pre>
                ) : (
                    <span
                        className={`whitespace-pre-wrap break-words text-xs text-colorErrorText ${
                            big ? "line-clamp-3" : ""
                        }`}
                        title={big ? text : undefined}
                    >
                        {text}
                    </span>
                )}
                {big && (
                    <button
                        type="button"
                        onClick={() => setExpanded({key: stateKey, value: !expanded})}
                        aria-expanded={expanded}
                        className="-ml-1 cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-xs font-medium text-colorError transition-colors hover:bg-[var(--ant-color-error-bg)]"
                    >
                        {expanded ? "Show less" : "Show more"}
                    </button>
                )}
                {offerOwnKey && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="mt-1"
                        onClick={() => requestProviderDrawer(true)}
                    >
                        Add your key
                    </Button>
                )}
                {offerRetry && (
                    <Button size="sm" variant="outline" className="mt-1" onClick={onRetry}>
                        Try again
                    </Button>
                )}
            </div>
        </div>
    )
}

/** The bubble's avatar — the agent's own mark, or the Robot every turn had before. */
const MessageAvatar = ({isUser = false}: {isUser?: boolean}) => {
    const artifactId = useDriveArtifactId()
    // A draft agent has no persisted id to key an icon by.
    const workflowId = artifactId && !isLocalDraftId(artifactId) ? artifactId : null

    if (isUser) return <ChatBubbleAvatar icon={<User size={16} />} />
    return <AgentChatAvatar workflowId={workflowId} fallback={<Robot size={16} />} />
}

/** The started-but-empty assistant turn. Its own component so the startup tick mounts once per live
 * turn, not once per message in the transcript. */
const PendingTurn = ({sessionId}: {sessionId: string}) => {
    const startupPhase = useStartupPhase(sessionId)
    return startupPhase ? (
        <ChatBubble
            placement="start"
            variant="borderless"
            avatar={<MessageAvatar />}
            content={<StartupActivity label={startupPhase} />}
        />
    ) : (
        <ChatBubble placement="start" variant="borderless" avatar={<MessageAvatar />} loading />
    )
}

const triggerDownload = (href: string, name: string) => {
    const link = document.createElement("a")
    link.href = href
    link.download = name
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
}

const AttachmentFilePart = ({file, sessionId}: {file: FileUIPart; sessionId: string}) => {
    const attachmentId = attachmentIdForPart(file)
    const source = useAttachmentMediaSrc(attachmentId ? sessionId : null, attachmentId)
    const src = attachmentId ? source.src : file.url
    const name = filePartName(file)
    const [fallbackDownloadPending, setFallbackDownloadPending] = useState(false)

    useEffect(() => {
        if (!fallbackDownloadPending) return
        if (source.src?.startsWith("blob:")) {
            triggerDownload(source.src, name)
            setFallbackDownloadPending(false)
        } else if (source.failed) {
            setFallbackDownloadPending(false)
        }
    }, [fallbackDownloadPending, name, source.failed, source.src])

    const handleDownload = async () => {
        if (!src) return
        // Already a local blob (the axios fallback resolved it) — save it straight off.
        if (src.startsWith("blob:") || !attachmentId) {
            triggerDownload(src, name)
            return
        }
        try {
            const response = await fetch(src, {credentials: "include"})
            if (!response.ok) throw new Error("Direct attachment download failed")
            const objectUrl = URL.createObjectURL(await response.blob())
            triggerDownload(objectUrl, name)
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
        } catch {
            // The direct route can lack browser credentials; activate the lazy axios/blob fallback.
            setFallbackDownloadPending(true)
            source.onError()
        }
    }

    return (
        <AttachmentCard
            name={name}
            mediaType={file.mediaType ?? ""}
            src={src ?? undefined}
            action={src && !source.failed ? "download" : "none"}
            onDownload={() => void handleDownload()}
        />
    )
}

/**
 * Read-only renderer for one agent conversation message, rendered inside an Ant Design X
 * `Bubble`. Walks `message.parts` in order (text → markdown, reasoning, tool calls +
 * approvals, sources) for the bubble body, and puts the per-message action row in the
 * footer. While an assistant message has no content yet, the bubble shows the loading state.
 */
const AgentMessage = ({
    message,
    sessionId,
    isStreaming = false,
    isLastMessage = false,
    onRewind,
    onClientToolOutput,
    precededByEmptyAssistant = false,
    turnTraceId,
    onRetry,
}: AgentMessageProps) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const isUser = message.role === "user"
    // Build vs Chat: Build (config panel open, not maximized) shows the full step log — per-tool
    // input/output/error + expanded reasoning; Chat keeps the calm collapsed summary.
    const detailed = !useAtomValue(chatPanelMaximizedAtom)

    const traceId = getMessageTraceId(message)
    const usage = getMessageUsage(message)
    // A failed run (e.g. a quota error the runner swallowed into an empty turn) lands as an
    // error on the message's OWN trace; read it so the bubble can render as a failure.
    const ownSummary = useAtomValue(traceDataSummaryAtomFamily(traceId ?? null))
    const traceError = ownSummary.error
    // A failure can reach us two ways: recorded on the trace (backend), or stamped onto the turn
    // FE-side from the useChat stream error (AgentChatPanel). `errorText` is derived below, once
    // we know whether the turn produced an answer.
    const runError = getMessageRunError(message)
    const runErrorCode = getMessageRunErrorCode(message)
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

    // Copy the answer; append the error on a failed turn (and copy it alone on an answer-less
    // failure) so the button isn't a no-op when the agent only returned an error.
    const copyText = [fullText, errorText].filter(Boolean).join("\n\n")

    // Dedup set of executed tool calls (by input identity), memoized on a cheap tool-parts signature
    // (id + state) that stays STABLE while text streams — so the tool-input JSON.stringify doesn't
    // re-run on every streamed token of a tool-heavy turn. Hoisted above the early returns below to
    // keep hook order stable.
    const toolSignature = message.parts
        .filter((p) => isToolPart(p.type))
        .map((p) => `${(p as ToolUIPart).toolCallId ?? ""}:${(p as ToolUIPart).state ?? ""}`)
        .join("|")
    const executedToolIdentities = useMemo(
        () =>
            new Set(
                message.parts
                    .filter(
                        (p) =>
                            isToolPart(p.type) &&
                            ((p as ToolUIPart).state === "output-available" ||
                                (p as ToolUIPart).state === "output-error"),
                    )
                    .map((p) => toolIdentity(p as ToolUIPart)),
            ),
        [toolSignature],
    )

    // Message-scoped render hints (sibling `data-render` parts). Memoized so the stable reference
    // doesn't bust the memoized ClientToolPart on nowTick re-renders. Must sit with the other hooks
    // (above the early returns) to satisfy rules-of-hooks.
    const renderMap = useMemo(
        () => buildRenderMap(message.parts as {type?: string; data?: unknown}[]),
        [message.parts],
    )

    // #3: collapse a run of empty "no response" turns to just the first. A turn with ANY content
    // (answer or reasoning) and any error turn (isError, which shows the real failure) always
    // render; only a truly-empty, non-error turn that follows another empty turn is hidden.
    if (noResponse && !showError && !hasContent && precededByEmptyAssistant) return null

    // Only the message being generated shows the loading state, and only until it has content.
    if (!isUser && isStreaming && !hasContent) {
        return <PendingTurn sessionId={sessionId} />
    }

    // Tools can be interleaved with text / reasoning, so fold only *consecutive* tool parts
    // into one ToolActivity group (a run of calls reads as a single "Used N tools" line).
    type RenderItem =
        | {kind: "part"; part: UIMessage["parts"][number]; index: number}
        | {kind: "tools"; parts: ToolUIPart[]; index: number}
        | {kind: "clientTool"; part: ToolUIPart; index: number}
        | {kind: "files"; parts: FileUIPart[]; index: number}
    // A HITL-approved tool's part LINGERS in `approval-responded` (a perpetual spinner, no output):
    // the cold-replay runner re-issues the approved call under a FRESH id, so its execution output
    // lands on a SEPARATE sibling part. Drop the answered gate once its executed sibling exists (same
    // tool + same input), so the turn shows the single completed call with its output — not a stuck
    // spinner beside a duplicate. Until the execution settles, the gate stays (it is genuinely
    // in-flight).
    const isSupersededGate = (p: ToolUIPart): boolean =>
        p.state === "approval-responded" && executedToolIdentities.has(toolIdentity(p))

    // The elicitation retry cap: did an elicitation already degrade earlier this turn?
    const degradedEarlierInTurn = hasPriorElicitationDegradation(
        message.parts as {state?: string; errorText?: string}[],
    )

    const renderItems: RenderItem[] = []
    message.parts.forEach((part, i) => {
        if (isToolPart(part.type)) {
            // The answered gate whose execution already landed on a sibling part — drop it so the
            // turn doesn't show a stuck approval spinner beside the real, completed call.
            if (isSupersededGate(part as ToolUIPart)) return
            // A browser-fulfilled client tool (#4920) renders as its own widget/chip, NOT folded
            // into the "Used N tools" group — so it breaks any current tool run.
            if (isClientToolPart(part as ToolUIPart, {isStreaming, isLastMessage}, renderMap)) {
                renderItems.push({kind: "clientTool", part: part as ToolUIPart, index: i})
                return
            }
            const last = renderItems[renderItems.length - 1]
            if (last && last.kind === "tools") last.parts.push(part as ToolUIPart)
            else renderItems.push({kind: "tools", parts: [part as ToolUIPart], index: i})
            return
        }
        // Consecutive attachments share one grid, so a message's files lay out as a block
        // instead of one full-width card per part.
        if (part.type === "file") {
            const last = renderItems[renderItems.length - 1]
            if (last && last.kind === "files") last.parts.push(part as FileUIPart)
            else renderItems.push({kind: "files", parts: [part as FileUIPart], index: i})
            return
        }
        renderItems.push({kind: "part", part, index: i})
    })
    const renderLeafPart = (part: UIMessage["parts"][number], i: number) => {
        // Stable, globally-unique key per rendered part. The part index alone collides
        // across messages that React reconciles together (duplicate-key warnings); the
        // message id scopes it so each part is unique across the whole conversation.
        const partKey = `${message.id}-${i}`
        if (part.type === "text") {
            const text = (part as {text: string}).text
            if (!text) return null
            // Render markdown for both roles so typed markdown displays properly. Only the LAST
            // text part of the message being generated animates — earlier parts are settled.
            const lastTextIndex = message.parts.reduce(
                (acc, candidate, idx) => (candidate.type === "text" ? idx : acc),
                -1,
            )
            return (
                <StreamingMarkdown
                    key={partKey}
                    content={text}
                    streaming={isStreaming && i === lastTextIndex}
                    // Something already renders below this part, so it must not keep typing.
                    urgent={i !== message.parts.length - 1}
                />
            )
        }
        if (part.type === "reasoning") {
            const reasoning = part as ReasoningUIPart
            if (!reasoning.text) return null
            return (
                <ReasoningPart
                    key={partKey}
                    stateKey={reasoningKey(message.id, i)}
                    text={reasoning.text}
                    streaming={reasoning.state === "streaming"}
                    urgent={i !== message.parts.length - 1}
                />
            )
        }
        return null
    }

    const defaultBody = (
        <div className="flex min-w-0 max-w-full flex-col gap-2">
            {renderItems.map((item) => {
                if (item.kind === "files") {
                    return (
                        <AttachmentCardGrid key={`${message.id}-files-${item.index}`}>
                            {item.parts.map((file, n) => (
                                <AttachmentFilePart
                                    key={`${message.id}-file-${item.index}-${n}`}
                                    file={file}
                                    sessionId={sessionId}
                                />
                            ))}
                        </AttachmentCardGrid>
                    )
                }
                if (item.kind === "tools") {
                    return (
                        <ToolActivity
                            key={`${message.id}-tools-${item.index}`}
                            parts={item.parts}
                            isStreaming={isStreaming}
                            detailed={detailed}
                        />
                    )
                }
                if (item.kind === "clientTool") {
                    return (
                        <ClientToolPart
                            key={`${message.id}-clienttool-${item.part.toolCallId || item.index}`}
                            part={item.part}
                            onOutput={onClientToolOutput}
                            renderMap={renderMap}
                            degradedEarlierInTurn={degradedEarlierInTurn}
                        />
                    )
                }
                return renderLeafPart(item.part, item.index)
            })}

            {sources.length > 0 && (
                <div className="flex flex-col gap-0.5 pt-1">
                    <span className="text-xs uppercase tracking-wide text-colorTextSecondary">
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
                <span className="text-xs italic text-colorTextSecondary">
                    No response — the agent ended its turn without answering.
                </span>
            )}
        </div>
    )

    // Failed run: the whole bubble reads as the error (red), message inline — no nested box.
    // RunErrorBody shows an everyday reason in full; only a big one collapses behind "Show more".
    const errorBody = (
        <RunErrorBody
            text={errorText || "The agent run failed."}
            stateKey={errorKey(message.id)}
            code={runErrorCode}
            onRetry={onRetry ? () => onRetry(message.id) : undefined}
        />
    )

    // A long pasted message clamps behind "Show more" so it can't bury the reply it belongs to.
    // User turns only: an agent answer is the thing you came to read.
    const contentBody = isUser ? (
        <CollapsibleMessageBody stateKey={messageBodyKey(message.id)}>
            {defaultBody}
        </CollapsibleMessageBody>
    ) : (
        defaultBody
    )

    // Partial output then failure: show the content AND the error. Answer-less failure: the
    // whole bubble is the error. Otherwise: just the content.
    const body =
        showError && !isError ? (
            <div className="flex min-w-0 max-w-full flex-col gap-2">
                {contentBody}
                {errorBody}
            </div>
        ) : isError ? (
            errorBody
        ) : (
            contentBody
        )

    // The turn's meta line, in a reserved lane BELOW the bubble (the `pb-8` on the row), so it
    // never overlays the last content line and never reaches the next turn. The lane is always
    // present (stable height), so revealing it only fades opacity — no layout shift either way (the
    // scroll engineering is sensitive to hover-driven reflow). `pointer-events-none` while hidden
    // keeps the invisible buttons unclickable. The buttons carry no `disabled`, so the busy guard
    // lives in the handlers: `onRewind` → `handleRewind` early-returns while a stream is in flight.
    const toolbarReveal = turnToolbarRevealClass

    // `group relative` → the toolbar reveals on hover/focus of the whole message row and anchors
    // to the reserved lane (`pb-8`) at the row's bottom. The row is a flex that justifies the
    // (width-capped) bubble to its side, so the opposite side keeps whitespace — agent bubbles hug
    // the left, user bubbles the right, neither spans the full column.
    // `ag-turn` is the hook the transcript's bottom fade watches (see BOTTOM_FADE_OVERLAY_STYLE):
    // it drops the fade while this row is hovered/focused, so the revealed toolbar can't be washed.
    return (
        <div className={`${turnRowClass} ${isUser ? "justify-end" : "justify-start"}`}>
            <ChatBubble
                placement={isUser ? "end" : "start"}
                // Borderless assistant turns: content sits on the panel bg with just the avatar and
                // spacing, so tool cards aren't wrapped in an extra outline. User stays filled.
                variant={isUser ? "filled" : "borderless"}
                avatar={<MessageAvatar isUser={isUser} />}
                className="min-w-0 max-w-[85%]"
                classNames={{
                    // Error styling is a self-contained callout in RunErrorBody now, not painted on
                    // the (borderless) bubble content — otherwise it bleeds edge-to-edge with no pad.
                    // The user turn reads as "mine" via a soft accent-tinted card; the agent turn
                    // stays borderless on the canvas.
                    content: isUser
                        ? `${userBubbleContentClass} border border-solid border-[var(--ag-user-bubble-border)] bg-[var(--ag-user-bubble-bg)]`
                        : "min-w-0 max-w-full overflow-hidden",
                    body: "min-w-0 max-w-full overflow-hidden",
                }}
                content={body}
            />
            <div
                className={`${turnToolbarClass} ${isUser ? "right-11" : "left-11"} ${toolbarReveal}`}
            >
                <TurnFooter
                    messageId={message.id}
                    traceId={traceId}
                    turnTraceId={turnTraceId}
                    isUser={isUser}
                    isStreaming={isStreaming}
                    usage={usage}
                    copyText={copyText}
                    // Rewinding the LAST turn just re-runs the turn that's already current, so hide it.
                    onRewind={isLastMessage ? undefined : () => onRewind(message)}
                    onViewTrace={(id) => openTraceDrawer({traceId: id})}
                />
            </div>
        </div>
    )
}

export default memo(AgentMessage)
