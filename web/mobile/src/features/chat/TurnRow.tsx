import {memo, useCallback, useMemo, useRef} from "react"

import {
    getMessageTraceId,
    getMessageUsage,
    isPendingSendFailed,
    PENDING_SEND_FAILED_NOTE,
} from "@agenta/chat/assets"
import {ClientToolPart, type ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {
    ActivityTimeline,
    AttachmentCard,
    AttachmentCardGrid,
    CollapsibleMessageBody,
    TurnFooter,
} from "@agenta/chat/components"
import {useHeldFor} from "@agenta/chat/hooks"
import {endsOnClosedText, splitTurnActivity, type TurnViewModel} from "@agenta/chat/model"
import {messageBodyKey} from "@agenta/chat/state"
import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {buildRenderMap} from "@agenta/playground/agent-chat"
import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {hasPriorElicitationDegradation} from "@agenta/shared/utils"
import {
    ChatBubble,
    turnToolbarClass,
    turnToolbarRevealClass,
    userBubbleContentClass,
} from "@agenta/ui/components/presentational"
import type {ToolUIPart} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {cn} from "@/lib/utils"

import {AnswerReveal} from "./AnswerReveal"
import {AssistantMarkdown, UserMarkdown} from "./AssistantMarkdown"
import {continuationRetryAction} from "./continuationRetry"
import {isLiveTextItem} from "./markdownStream"
import {RunErrorCallout} from "./RunErrorCallout"
import {mobileTurnRowClass} from "./turnRowClass"

/** The content endpoint carries the session cookie, so a same-origin anchor saves it directly. */
const downloadAttachment = (url: string, name: string) => {
    const link = document.createElement("a")
    link.href = url
    link.download = name
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
}

/** One transcript turn: a user bubble, or an assistant fold, answer, meta line and any run error. */
/** How long a closed text waits for a following call; it only ever delays while the run is open. */
const ANSWER_HOLD_MS = 1200
const ASSISTANT_META: ("tokens" | "cost")[] = ["tokens", "cost"]

const TurnRowInner = ({
    turn,
    onClientToolOutput,
    onRewind,
    sessionId,
    remoteRunning = false,
    waitingOnUser = false,
    runId,
    firstTurn = false,
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
    /** The run is going on elsewhere (another client, a poll): the last turn reads live. */
    remoteRunning?: boolean
    /** The run is parked on the reader: the last turn's fold line says so. */
    waitingOnUser?: boolean
    /** Keys the clock and fold to the run, so the placeholder turn's carry to the real one. */
    runId?: string
    /** The session's first response: the one that narrates the agent's startup. */
    firstTurn?: boolean
}) => {
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
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

    const footer = {
        messageId: turn.message.id,
        traceId,
        turnTraceId: turn.turnTraceId,
        isStreaming: turn.isStreamingTurn,
        usage,
        copyText,
        // Rewinding the last turn re-runs the current one; hidden, as on desktop.
        onRewind: onRewind && !turn.isLast ? () => onRewind(turn) : undefined,
        onViewTrace: (id: string) => openTraceDrawer({traceId: id}),
        // The time is the fold's line ("Worked for 11s"); the meta keeps the rest.
        metrics: ASSISTANT_META,
    }
    // Live while this client streams it, or while a poll says the run goes on elsewhere.
    const live = !turn.isUser && (turn.isStreamingTurn || (turn.isLast && remoteRunning))
    // A failure the records never carried lives on the trace: a model call that died with no
    // answer. Read only for an answer-less settled turn, as the desktop does.
    const answerless = !turn.isUser && turn.status.noResponse && !live && !turn.status.showError
    const traceSummary = useAtomValue(
        traceDataSummaryAtomFamily(answerless && traceId ? traceId : ""),
    )
    const traceError = answerless ? (traceSummary.error ?? null) : null
    const errorText = turn.status.showError
        ? (turn.status.errorText ?? "Something went wrong.")
        : traceError
    // A just-closed text becomes the answer after a beat: a following call lands a commit later.
    const trailingClosed = useMemo(() => endsOnClosedText(turn.items), [turn.items])
    // Hold while the run is open anywhere. A turn this client streamed is over the moment its
    // stream closes, so it never waits on the liveness poll that still says "running".
    const streamedHereRef = useRef(false)
    if (turn.isStreamingTurn) streamedHereRef.current = true
    const runOpen = turn.isStreamingTurn || (live && !streamedHereRef.current)
    const closedLongEnough = useHeldFor(trailingClosed && runOpen, ANSWER_HOLD_MS)
    const activity = useMemo(
        () =>
            splitTurnActivity(turn.items, {
                holdClosedText: runOpen && trailingClosed && !closedLongEnough,
            }),
        [turn.items, runOpen, trailingClosed, closedLongEnough],
    )
    // Browser-fulfilled tools keep their place on the timeline, widget and all.
    const renderClientTool = useCallback(
        (part: ToolUIPart) =>
            onClientToolOutput ? (
                <ClientToolPart
                    part={part}
                    onOutput={onClientToolOutput}
                    renderMap={renderMap}
                    degradedEarlierInTurn={degradedEarlierInTurn}
                    bare
                />
            ) : null,
        [onClientToolOutput, renderMap, degradedEarlierInTurn],
    )

    const body = turn.isUser ? (
        <div className="flex min-w-0 max-w-full flex-col gap-2">
            {turn.items.map((item) => {
                if (item.kind !== "part" || item.part.type !== "text") return null
                if (!(item.part.text ?? "").trim()) return null
                // Markdown, as the desktop bubble renders it: the composer's export is markdown.
                return <UserMarkdown key={item.index} text={item.part.text ?? ""} />
            })}
        </div>
    ) : (
        <div className="flex min-w-0 max-w-full flex-col gap-3">
            <ActivityTimeline
                messageId={turn.message.id}
                clockId={runId}
                sessionId={sessionId}
                steps={activity.steps}
                streaming={live}
                answerStarted={activity.answer !== null}
                waitingOnUser={turn.isLast && waitingOnUser}
                traceId={traceId}
                firstTurn={firstTurn}
                renderClientTool={renderClientTool}
            />
            {activity.answer ? (
                <AnswerReveal animate={live}>
                    <AssistantMarkdown
                        streaming={isLiveTextItem(turn, activity.answerIndex)}
                        text={activity.answer.text}
                    />
                </AnswerReveal>
            ) : null}
            {errorText ? (
                <RunErrorCallout
                    text={errorText}
                    // Failed before any step: nothing to hang a node on, so it is its own card.
                    variant={activity.steps.length ? "step" : "card"}
                    onRetry={continuationRetryAction(
                        turn,
                        onRewind ? () => onRewind(turn) : undefined,
                    )}
                />
            ) : answerless && !traceSummary.isPending ? (
                <span className="text-xs italic text-colorTextSecondary">
                    No response — the agent ended its turn without answering.
                </span>
            ) : null}
            {/* The turn's meta line sits under the answer, revealed on hover or focus like the
                desktop's; the row keeps its height so nothing shifts when it appears. Not while
                the run is parked on the reader: the turn is not over, only waiting. */}
            {!live && !(turn.isLast && waitingOnUser) ? (
                <div
                    className={`flex min-h-6 items-center gap-1 ${
                        inspectorEnabled ? "" : turnToolbarRevealClass
                    }`}
                >
                    <TurnFooter {...footer} isUser={false} />
                </div>
            ) : null}
        </div>
    )

    // Attachments hang above the bubble rather than inside its fill, so a message reads as its
    // files first and its words second.
    const fileItems = turn.items.filter((item) => item.kind === "files")
    const attachments = fileItems.length ? (
        <div className="flex flex-col gap-2">
            {fileItems.map((item) => (
                <AttachmentCardGrid key={item.index}>
                    {item.parts.map((file, n) => (
                        <AttachmentCard
                            key={`${item.index}-${n}`}
                            name={file.filename || file.mediaType || "attachment"}
                            mediaType={file.mediaType ?? ""}
                            src={file.url}
                            action={file.url ? "download" : "none"}
                            onDownload={() =>
                                downloadAttachment(
                                    file.url,
                                    file.filename || file.mediaType || "attachment",
                                )
                            }
                        />
                    ))}
                </AttachmentCardGrid>
            ))}
        </div>
    ) : null
    // Attachments with no words paint no bubble; an assistant turn always paints its fold line.
    const hasBubbleContent =
        !turn.isUser ||
        turn.items.some(
            (item) =>
                item.kind !== "files" &&
                !(
                    item.kind === "part" &&
                    item.part.type === "text" &&
                    !(item.part.text ?? "").trim()
                ),
        ) ||
        turn.status.showError

    // Desktop parity: a long pasted message clamps behind "Show more" rather than burying its reply.
    const userBody = turn.isUser ? (
        <CollapsibleMessageBody stateKey={messageBodyKey(turn.message.id)}>
            {body}
        </CollapsibleMessageBody>
    ) : (
        body
    )

    // A send the server refused after the composer had already cleared. The row keeps the text so
    // it is not lost; this says why it is sitting there with no answer coming.
    const failureNote = isPendingSendFailed(turn.message) ? (
        <div
            data-pending-send-failed="true"
            role="status"
            className="mt-1 text-[11px] leading-4 opacity-80"
        >
            {PENDING_SEND_FAILED_NOTE}
        </div>
    ) : null
    const content = failureNote ? (
        <div className="flex min-w-0 max-w-full flex-col">
            {userBody}
            {failureNote}
        </div>
    ) : (
        userBody
    )

    return (
        <div className={`${mobileTurnRowClass} ${turn.isUser ? "justify-end" : "justify-start"}`}>
            <ChatBubble
                placement={turn.isUser ? "end" : "start"}
                variant={turn.isUser && hasBubbleContent ? "filled" : "borderless"}
                // No avatar column; the 85% inset is what reads as a user bubble.
                className={
                    turn.isUser ? "min-w-0 max-w-[85%]" : "min-w-0 max-w-full sm:max-w-[85%]"
                }
                classNames={{
                    content: turn.isUser
                        ? cn(userBubbleContentClass, "rounded-md text-xs")
                        : "min-w-0 max-w-full overflow-hidden text-xs",
                    body: "min-w-0 max-w-full overflow-hidden",
                }}
                // A refused file-only send has no words to paint, but its failure still has to be
                // said, or the cards sit there looking like an upload that worked.
                content={hasBubbleContent ? content : failureNote}
                header={attachments}
            />
            {/* A user turn's actions, revealed on hover or keyboard focus — the lane the desktop
                transcript reserves. An assistant turn carries its meta line in flow instead. The
                debug trace action stays visible on touch while the inspector flag is on. */}
            {turn.isUser ? (
                <div
                    className={`${turnToolbarClass} ${
                        inspectorEnabled
                            ? "pointer-events-auto opacity-100"
                            : turnToolbarRevealClass
                    } right-0`}
                >
                    <TurnFooter {...footer} isUser />
                </div>
            ) : null}
        </div>
    )
}

// Memoized: the conversation commits once per streamed chunk; unchanged turns stay identity-stable.
export const TurnRow = memo(TurnRowInner)
