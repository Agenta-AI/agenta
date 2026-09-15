import {memo, useCallback, useEffect, useMemo, useState, type ReactNode} from "react"

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
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {buildRenderMap} from "@agenta/playground/agent-chat"
import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {hasPriorElicitationDegradation} from "@agenta/shared/utils"
import {
    ChatBubble,
    turnRowClass,
    turnToolbarClass,
    turnToolbarRevealClass,
    userBubbleContentClass,
} from "@agenta/ui/components/presentational"
import type {ToolUIPart} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {AssistantMarkdown} from "./AssistantMarkdown"
import {continuationRetryAction} from "./continuationRetry"
import {isLiveTextItem} from "./markdownStream"
import {RunErrorCallout} from "./RunErrorCallout"

/** The answer fades in as the fold settles, so the reply arrives instead of popping. */
const AnswerReveal = ({animate, children}: {animate: boolean; children: ReactNode}) => {
    const [shown, setShown] = useState(!animate)
    useEffect(() => {
        if (shown) return
        const id = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(id)
    }, [shown])
    return (
        <div className={`transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}>
            {children}
        </div>
    )
}

/**
 * The assistant turn that does not exist yet: the request is in and no part has arrived. It
 * wears the same live fold line every working turn does — the startup narration (#6047) as its
 * verb, the clock beside it — so the wait reads as the run starting, not the app stalling.
 */
export const PendingTurn = ({
    sessionId,
    runId,
    firstTurn = false,
}: {
    sessionId: string
    /** The run's clock key — the assistant turn that follows inherits it. */
    runId?: string
    /** The session's first response: the one that narrates the agent's startup. */
    firstTurn?: boolean
}) => {
    return (
        <div className={`${turnRowClass} justify-start`}>
            <ChatBubble
                placement="start"
                variant="borderless"
                className="min-w-0 max-w-full sm:max-w-[85%]"
                classNames={{content: "min-w-0 max-w-full overflow-hidden text-xs"}}
                content={
                    <ActivityTimeline
                        messageId={runId ?? `pending:${sessionId}`}
                        sessionId={sessionId}
                        steps={[]}
                        streaming
                        answerStarted={false}
                        firstTurn={firstTurn}
                    />
                }
            />
        </div>
    )
}

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

/**
 * One transcript turn on the shared bubble chrome — the mobile face of the desktop
 * AgentMessage: user turns as filled bubbles hugging the right, assistant turns flush on the
 * canvas, no avatars. An assistant turn is its activity fold (thoughts and
 * tool steps under one collapsed line), then its answer, then its meta line; a failed run adds
 * the red callout.
 */
/** How long a closed trailing text waits for a following call before it reads as the answer. */
const ANSWER_HOLD_MS = 400
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
    /** Keys the working clock to the run, not the message, so the clock the placeholder turn
     * started keeps counting once the real turn replaces it. */
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

    // The last assistant turn is live while this client streams it, or while a poll says the run
    // is still going somewhere else.
    const live = !turn.isUser && (turn.isStreamingTurn || (turn.isLast && remoteRunning))
    // A text the runner just closed becomes the answer only after a beat: the tool call that
    // would make it an aside arrives a commit or two behind its `text-end`.
    const trailingClosed = useMemo(() => endsOnClosedText(turn.items), [turn.items])
    const closedLongEnough = useHeldFor(trailingClosed && turn.isStreamingTurn, ANSWER_HOLD_MS)
    const activity = useMemo(
        () =>
            splitTurnActivity(turn.items, {
                holdClosedText: turn.isStreamingTurn && trailingClosed && !closedLongEnough,
            }),
        [turn.items, turn.isStreamingTurn, trailingClosed, closedLongEnough],
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
                // What the user typed renders literally — markdown in your own words is
                // surprising (desktop parity).
                return (
                    <p key={item.index} className="m-0 whitespace-pre-wrap break-words text-xs">
                        {item.part.text}
                    </p>
                )
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
            {turn.status.showError ? (
                <RunErrorCallout
                    text={turn.status.errorText ?? "Something went wrong."}
                    onRetry={continuationRetryAction(
                        turn,
                        onRewind ? () => onRewind(turn) : undefined,
                    )}
                />
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
                    <TurnFooter
                        messageId={turn.message.id}
                        traceId={traceId}
                        turnTraceId={turn.turnTraceId}
                        isUser={false}
                        isStreaming={turn.isStreamingTurn}
                        usage={usage}
                        copyText={copyText}
                        // Rewinding the LAST turn just re-runs the turn that is already current,
                        // so the desktop hides it there and so do we.
                        onRewind={onRewind && !turn.isLast ? () => onRewind(turn) : undefined}
                        onViewTrace={(id) => openTraceDrawer({traceId: id})}
                        // The time is the fold's line ("Worked for 11s"); the meta keeps the rest.
                        metrics={ASSISTANT_META}
                    />
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
    // Attachments with no words: there is no bubble to paint, only the cards. An empty text part
    // counts as no words — a turn carrying only files still arrives with one. An assistant turn
    // always paints: its fold line is the content while nothing else has arrived.
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
        <div className={`${turnRowClass} ${turn.isUser ? "justify-end" : "justify-start"}`}>
            <ChatBubble
                placement={turn.isUser ? "end" : "start"}
                variant={turn.isUser && hasBubbleContent ? "filled" : "borderless"}
                // No avatar column: turns sit flush with the composer's edge. The 85% inset is what
                // reads as a user BUBBLE; a borderless agent turn only loses width to it.
                className={
                    turn.isUser ? "min-w-0 max-w-[85%]" : "min-w-0 max-w-full sm:max-w-[85%]"
                }
                classNames={{
                    content: turn.isUser
                        ? `${userBubbleContentClass} text-xs`
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
                    <TurnFooter
                        messageId={turn.message.id}
                        traceId={traceId}
                        turnTraceId={turn.turnTraceId}
                        isUser
                        isStreaming={turn.isStreamingTurn}
                        usage={usage}
                        copyText={copyText}
                        onRewind={onRewind && !turn.isLast ? () => onRewind(turn) : undefined}
                        onViewTrace={(id) => openTraceDrawer({traceId: id})}
                        // The time is the fold's line ("Worked for 11s"); the meta keeps the rest.
                        metrics={ASSISTANT_META}
                    />
                </div>
            ) : null}
        </div>
    )
}

/**
 * Memoized: the conversation commits once per streamed chunk, and without this every turn in the
 * transcript re-rendered on every one of them. Holds because `buildTurnViewModels` now keeps
 * unchanged turns identity-stable and the host passes stable callbacks.
 */
export const TurnRow = memo(TurnRowInner)
