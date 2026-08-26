import {useMemo, useState} from "react"

import {getMessageTraceId, getMessageUsage} from "@agenta/chat/assets"
import {ClientToolPart, type ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {StartupActivity, TurnFooter} from "@agenta/chat/components"
import {useTypewriter} from "@agenta/chat/hooks"
import {partSentence, partToolName, rowSummary, type TurnViewModel} from "@agenta/chat/model"
import {resolveToolDisplay} from "@agenta/chat/skin"
import {useStartupPhase} from "@agenta/chat/state"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {buildRenderMap} from "@agenta/playground"
import {hasPriorElicitationDegradation} from "@agenta/shared/utils"
import {
    ChatBubble,
    ChatBubbleAvatar,
    ChatTypingDots,
    turnRowClass,
    turnToolbarClass,
    turnToolbarRevealClass,
} from "@agenta/ui/components/presentational"
import {useSetAtom} from "jotai"
import {
    Ban,
    Bot,
    Brain,
    CheckCircle2,
    ChevronRight,
    CircleDashed,
    User,
    Wrench,
    XCircle,
} from "lucide-react"

import {AssistantMarkdown} from "./AssistantMarkdown"
import {AttachmentPart} from "./AttachmentPart"
import {isLiveTextItem} from "./markdownStream"

type ToolsItem = Extract<TurnViewModel["items"][number], {kind: "tools"}>

/** Desktop ReasoningPart's shape: a caret+brain toggle over a muted italic aside. */
const ReasoningFold = ({
    text,
    streaming,
    urgent,
}: {
    text: string
    streaming: boolean
    urgent?: boolean
}) => {
    const [manual, setManual] = useState<boolean | null>(null)
    const open = manual ?? streaming
    const {text: revealed} = useTypewriter(text, {urgent})
    return (
        <div className="flex max-w-full flex-col">
            <button
                type="button"
                onClick={() => setManual(!open)}
                aria-expanded={open}
                className="text-colorTextSecondary -ml-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs italic"
            >
                <ChevronRight
                    className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
                />
                <Brain className="size-3" />
                <span>{streaming ? "Thinking…" : "Thought"}</span>
            </button>
            {open ? (
                <div className="text-colorTextTertiary ml-5 mt-1 whitespace-pre-wrap text-xs">
                    {revealed}
                </div>
            ) : null}
        </div>
    )
}

/** One tool group, desktop ToolActivity's header language: status glyph + name + summary.
 *
 * The name is the HUMANISED sentence the shared resolver builds ("Reading a file"), not the wire
 * name — the desktop has read that way since the tool-activity work landed, and rendering
 * `partToolName` here left /m showing "read" beside prod's "Reading a file failed". */
const ToolLines = ({item}: {item: ToolsItem}) => (
    <div className="flex flex-col gap-1 py-0.5">
        {item.parts.map((tool, i) => {
            const key = tool.toolCallId ?? `${item.index}-${i}`
            const state = tool.state as string
            // Desktop's per-state header language: a gate is a warning wrench marked "Awaiting
            // approval" (the decision lives in the bottom ApprovalDock), a denial gets the quiet
            // ban glyph, and everything unsettled spins.
            const awaiting = state === "approval-requested"
            const denied = state === "output-denied"
            const failed = state === "output-error"
            const settled = state === "output-available" || state === "approval-responded"
            const summary = awaiting ? "Awaiting approval" : denied ? "denied" : rowSummary(tool)
            const display = resolveToolDisplay(
                partToolName(tool),
                (tool as {input?: unknown}).input,
                undefined,
                (tool as {output?: unknown}).output,
            )
            const shownName = partSentence(tool, display.activity)
            // Drop a summary the sentence already made: "Reading a file failed · failed" is the
            // same word twice. The desktop row reads sentence + technical detail, not both.
            const midText =
                summary && shownName.toLowerCase().endsWith(summary.toLowerCase()) ? null : summary
            return (
                <p
                    key={key}
                    className="m-0 flex min-w-0 items-center gap-2 overflow-hidden text-xs"
                >
                    {awaiting ? (
                        <Wrench className="text-colorWarning size-3.5 shrink-0" />
                    ) : denied ? (
                        <Ban className="text-colorTextTertiary size-3.5 shrink-0" />
                    ) : failed ? (
                        <XCircle className="text-colorError size-3.5 shrink-0" />
                    ) : settled ? (
                        <CheckCircle2 className="text-colorSuccess size-3.5 shrink-0" />
                    ) : (
                        <CircleDashed className="text-colorTextTertiary size-3.5 shrink-0 motion-safe:animate-spin" />
                    )}
                    {/* The sentence never yields, as on the desktop row: the detail and the status
                        beside it absorb the squeeze. With `min-w-0` here instead, every child was
                        equally shrinkable, so a long argument took the width and left "Listed
                        files" as "Li…" on a phone. `max-w-full` caps a sentence that is wider than
                        the row on its own, and the row clips what is left. */}
                    <span className="text-colorText max-w-full shrink-0 truncate font-medium">
                        {shownName}
                    </span>
                    {display.detail ? (
                        <span className="text-colorTextSecondary min-w-0 truncate font-mono">
                            {display.detail}
                        </span>
                    ) : null}
                    {midText ? (
                        <span
                            className={`min-w-0 truncate ${
                                failed ? "text-colorError" : "text-colorTextSecondary"
                            }`}
                        >
                            {midText}
                        </span>
                    ) : null}
                </p>
            )
        })}
    </div>
)

/** Desktop RunErrorBody's callout: the red card with a title and the reason inline. */
const RunErrorCallout = ({text}: {text: string}) => {
    const [expanded, setExpanded] = useState(false)
    const big = text.length > 240 || text.split("\n").length > 4
    return (
        <div className="bg-destructive/10 flex items-start gap-2 rounded-xl px-4 py-3">
            <XCircle className="text-colorError mt-px size-4 shrink-0" />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="text-colorError text-xs font-medium">The agent run failed</span>
                <span
                    className={`text-colorError whitespace-pre-wrap break-words text-xs ${
                        big && !expanded ? "line-clamp-3" : ""
                    }`}
                >
                    {text}
                </span>
                {big ? (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="text-colorError -ml-1 rounded px-1 py-0.5 text-[11px] font-medium"
                    >
                        {expanded ? "Show less" : "Show more"}
                    </button>
                ) : null}
            </div>
        </div>
    )
}

/**
 * The started-but-empty assistant turn: what the agent is DOING, in words, beside its avatar.
 *
 * The indicator belongs to the turn, not to the transcript. /m rendered it as a status line after
 * the whole list, so on a tall pane it floated far below the avatar it belonged to, detached from
 * anything. And it was wordless — the runner narrates its startup (#6047) so a cold boot reads as
 * progress rather than a stall, and /m dropped that narration entirely.
 */
const PendingTurn = ({sessionId}: {sessionId: string}) => {
    const startupPhase = useStartupPhase(sessionId)
    return (
        <div className={`${turnRowClass} justify-start`}>
            <ChatBubble
                placement="start"
                variant="borderless"
                avatar={<ChatBubbleAvatar icon={<Bot className="size-4" />} />}
                className="min-w-0 max-w-[85%]"
                content={
                    startupPhase ? <StartupActivity label={startupPhase} /> : <ChatTypingDots />
                }
            />
        </div>
    )
}

/**
 * One transcript turn on the shared bubble chrome — the mobile face of the desktop
 * AgentMessage: user turns as filled bubbles hugging the right, assistant turns flush on the
 * canvas, both with the 24px icon avatar; reasoning folds, tool lines with status glyphs, and
 * the red run-failure callout.
 */
export const TurnRow = ({
    turn,
    onClientToolOutput,
    onRewind,
    sessionId,
}: {
    turn: TurnViewModel
    /** Settles a browser-fulfilled tool (elicitation, connect) back into the run. Optional because
     * the read-only transcript screen has no engine to settle into — and it passes no client-tool
     * predicate either, so it never produces one of these items to begin with. */
    onClientToolOutput?: ClientToolOutputHandler
    /** Re-run the conversation from this turn. Absent on the read-only transcript screen. */
    onRewind?: (turn: TurnViewModel) => void
    /** Scopes the startup narration to this conversation. */
    sessionId: string
}) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const traceId = getMessageTraceId(turn.message)
    // `render.kind` rides as a sibling `data-render` part, so widget dispatch needs the map.
    const renderMap = useMemo(
        () => buildRenderMap(turn.message.parts as {type?: string; data?: unknown}[]),
        [turn.message.parts],
    )
    // The elicitation retry cap: did an elicitation already degrade earlier this turn?
    const degradedEarlierInTurn = hasPriorElicitationDegradation(
        turn.message.parts as {state?: string; errorText?: string}[],
    )
    const usage = getMessageUsage(turn.message)

    // The turn's text, which is what a reader wants on the clipboard — not its tool rows.
    const copyText = (turn.message.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => (part as {text?: string}).text ?? "")
        .join("\n")
        .trim()

    // Only the turn being generated shows the loading state, and only until it has content —
    // the same gate the desktop uses.
    if (!turn.isUser && turn.isStreamingTurn && !turn.status.hasContent) {
        return <PendingTurn sessionId={sessionId} />
    }

    const body = (
        <div className="flex min-w-0 max-w-full flex-col gap-2">
            {turn.items.map((item, position) => {
                if (item.kind === "part") {
                    if (item.part.type === "text") {
                        // What the user typed renders literally — markdown in your own words
                        // is surprising (desktop parity).
                        if (turn.isUser) {
                            return (
                                <p
                                    key={item.index}
                                    className="m-0 whitespace-pre-wrap break-words text-xs"
                                >
                                    {item.part.text}
                                </p>
                            )
                        }
                        return (
                            <AssistantMarkdown
                                key={item.index}
                                streaming={isLiveTextItem(turn, position)}
                                text={item.part.text}
                                urgent={position !== turn.items.length - 1}
                            />
                        )
                    }
                    if (item.part.type === "file") {
                        return <AttachmentPart key={item.index} part={item.part} />
                    }
                    if (item.part.type === "reasoning") {
                        return (
                            <ReasoningFold
                                key={item.index}
                                text={item.part.text}
                                streaming={isLiveTextItem(turn, position)}
                                urgent={position !== turn.items.length - 1}
                            />
                        )
                    }
                    return null
                }
                if (item.kind === "tools") {
                    return <ToolLines key={item.index} item={item} />
                }
                if (item.kind === "clientTool" && onClientToolOutput) {
                    return (
                        <ClientToolPart
                            key={`clienttool-${item.part.toolCallId || item.index}`}
                            part={item.part}
                            onOutput={onClientToolOutput}
                            renderMap={renderMap}
                            degradedEarlierInTurn={degradedEarlierInTurn}
                        />
                    )
                }
                return null
            })}
            {turn.status.showError ? (
                <RunErrorCallout text={turn.status.errorText ?? "Something went wrong."} />
            ) : null}
        </div>
    )

    return (
        <div className={`${turnRowClass} ${turn.isUser ? "justify-end" : "justify-start"}`}>
            <ChatBubble
                placement={turn.isUser ? "end" : "start"}
                variant={turn.isUser ? "filled" : "borderless"}
                avatar={
                    <ChatBubbleAvatar
                        icon={
                            turn.isUser ? <User className="size-4" /> : <Bot className="size-4" />
                        }
                    />
                }
                className="min-w-0 max-w-[85%]"
                classNames={{
                    content: "min-w-0 max-w-full overflow-hidden text-xs",
                    body: "min-w-0 max-w-full overflow-hidden",
                }}
                content={body}
            />
            {/* The turn's information and actions, revealed on hover or keyboard focus — the same
                lane the desktop transcript reserves, so a settled turn reads quietly until you
                reach for it. */}
            <div
                className={`${turnToolbarClass} ${turnToolbarRevealClass} ${
                    turn.isUser ? "right-11" : "left-11"
                }`}
            >
                <TurnFooter
                    messageId={turn.message.id}
                    traceId={traceId}
                    turnTraceId={turn.turnTraceId}
                    isUser={turn.isUser}
                    isStreaming={turn.isStreamingTurn}
                    usage={usage}
                    copyText={copyText}
                    // Rewinding the LAST turn just re-runs the turn that is already current, so the
                    // desktop hides it there and so do we.
                    onRewind={onRewind && !turn.isLast ? () => onRewind(turn) : undefined}
                    onViewTrace={(id) => openTraceDrawer({traceId: id})}
                />
            </div>
        </div>
    )
}
