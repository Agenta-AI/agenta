import {memo, useCallback, useEffect, useMemo, useRef} from "react"

import {
    getMessageTraceId,
    getMessageUsage,
    isMessageRunErrorTransport,
    isPendingSendFailed,
    PENDING_SEND_FAILED_NOTE,
} from "@agenta/chat/assets"
import {ClientToolPart, type ClientToolOutputHandler} from "@agenta/chat/clientTools"
import {
    ActivityTimeline,
    AttachmentStrip,
    type AttachmentStripFile,
    CollapsibleMessageBody,
    McpServerNoticeCard,
    TurnFooter,
} from "@agenta/chat/components"
import {useSessionTurnFooter} from "@agenta/chat/hooks"
import {readableTraceError, splitTurnActivity, type TurnViewModel} from "@agenta/chat/model"
import {messageBodyKey} from "@agenta/chat/state"
import {canViewSpansAtom} from "@agenta/entities/access"
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
import {isLiveTextItem} from "./markdownStream"
import {useBillingRoute, useCanBuyCredits, useProviderRecovery} from "./providerRecovery"
import {quotedMessageParts} from "./quotedMessageParts"
import {describeRunFailure, RunErrorMessage} from "./RunErrorMessage"
import {RunErrorRecovery} from "./RunErrorRecovery"
import {runRetryAction} from "./runRetry"
import {refreshOnSetupFailure} from "./setupFailureRefresh"
import {turnFiles} from "./turnFileList"
import {TurnFiles} from "./TurnFiles"
import {mobileTurnRowClass} from "./turnRowClass"
import {UserQuoteBlock} from "./UserQuoteBlock"
import {ARRIVED_ANSWER_ATTR, LAST_TURN_ATTR} from "./useTranscriptAutoScroll"

/** The byte size the transcript replay records on an attachment part, when it has one. */
const attachmentSize = (metadata: unknown): number | undefined => {
    const size = (metadata as {agenta?: {size?: unknown}} | undefined)?.agenta?.size
    return typeof size === "number" ? size : undefined
}

/** One transcript turn: a user bubble, or an assistant fold, answer, meta line and any run error. */
const ASSISTANT_META: ("tokens" | "cost")[] = ["tokens", "cost"]

const TurnRowInner = ({
    turn,
    onClientToolOutput,
    onRewind,
    sessionId,
    remoteRunning = false,
    waitingOnUser = false,
    resuming = false,
    runId,
    runStartedAt,
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
    /** The reader answered and the transcript still shows the ask — the fold reads as work. */
    resuming?: boolean
    /** Keys the clock and fold to the run, so the placeholder turn's carry to the real one. */
    runId?: string
    /** When the server saved the user message that started this run: the clock counts from it. */
    runStartedAt?: number
}) => {
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    // A reader whose role has no trace access gets no trace action and no trace read.
    const canViewSpans = useAtomValue(canViewSpansAtom)
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
    // A user turn has no trace of its own: it takes its time from the turn it started.
    const sessionTurn = useSessionTurnFooter({
        sessionId,
        traceId: turn.isUser ? turn.turnTraceId : traceId,
    })
    const openProviders = useProviderRecovery()
    const openBilling = useBillingRoute()
    const canBuyCredits = useCanBuyCredits(turn.status.errorCode)

    /**
     * Notices about a server that did not join the run, above the timeline rather than in it.
     *
     * `splitTurnActivity` folds only calls, client tools and the model's own text, so a notice has
     * no step to be; and `hiddenFromFold` keeps the failed call that produced it off the timeline
     * anyway, so the notice is the reader's ONLY signal that a server is missing. It renders
     * whether or not the call behind it is on screen.
     */
    const mcpNotices = useMemo(
        () => turn.items.filter((item) => item.kind === "mcpNotice"),
        [turn.items],
    )

    // The turn's text, which is what a reader wants on the clipboard — not its tool rows.
    const copyText = (turn.message.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => (part as {text?: string}).text ?? "")
        .join("\n")
        .trim()

    // Quoting is offered on settled answers only; mid-stream the text is still being written.
    const quoteProps =
        !turn.isUser && !turn.isStreamingTurn
            ? ({
                  "data-quotable": "true",
                  "data-quote-kind": "message",
                  "data-quote-message-id": turn.message.id,
              } as const)
            : undefined

    const footer = {
        messageId: turn.message.id,
        traceId,
        isStreaming: turn.isStreamingTurn,
        usage,
        sessionTurnFigures: sessionTurn.figures,
        sessionTurnStartedAt: sessionTurn.startedAt,
        sessionTurnsPending: sessionTurn.pending,
        copyText,
        // Rewinding the last turn re-runs the current one; hidden, as on desktop.
        onRewind: onRewind && !turn.isLast ? () => onRewind(turn) : undefined,
        onViewTrace: canViewSpans ? (id: string) => openTraceDrawer({traceId: id}) : undefined,
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
    // A trace keeps the provider's failure as it came back, which can be a raw JSON body with
    // account ids; only its sanitized sentence may reach the screen, as on the desktop.
    const traceError = answerless ? readableTraceError(traceSummary.error) : null
    const errorText = turn.status.showError
        ? (turn.status.errorText ?? "Something went wrong.")
        : traceError
    const runError = errorText
        ? describeRunFailure({
              text: errorText,
              code: turn.status.errorCode ?? undefined,
              transport: isMessageRunErrorTransport(turn.message),
              onRetry: runRetryAction(turn, onRewind ? () => onRewind(turn) : undefined),
              can: {providers: !!openProviders, buyCredits: canBuyCredits, plans: !!openBilling},
              onSignIn: openProviders,
          })
        : null
    // The latest turn failing for needs-setup refreshes the tags and the banner.
    const lastErrorCode = turn.isLast && errorText ? turn.status.errorCode : null
    useEffect(() => refreshOnSetupFailure(lastErrorCode), [lastErrorCode, turn.message.id])
    const streamedHereRef = useRef(false)
    if (turn.isStreamingTurn) streamedHereRef.current = true
    // The fold holds the work; every message the agent wrote to the reader shows below it, so a
    // message followed by a call or a card is never mistaken for thinking.
    const activity = useMemo(() => splitTurnActivity(turn.items), [turn.items])
    const answered = activity.messages.length > 0
    const writing = activity.messages.at(-1)?.part.state === "streaming"
    // Parked on the reader is open too: a message before a question is not the answer yet.
    const runOpen = live || (turn.isLast && (waitingOnUser || resuming))
    // An answer present at mount is history (reload, session open); a later one arrived live.
    // By message id alone: adoption can shift the answer's index without it being a new answer.
    // Only once the run is over: an interim message must not pin the scroll while work goes on.
    const answerKey = answered && !runOpen ? turn.message.id : null
    const mountAnswerKeyRef = useRef(answerKey)
    const rowMarkers = turn.isLast
        ? {
              [LAST_TURN_ATTR]: turn.isUser ? "user" : "assistant",
              ...(answerKey !== null && answerKey !== mountAnswerKeyRef.current
                  ? {[ARRIVED_ANSWER_ATTR]: answerKey}
                  : {}),
          }
        : undefined
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

    // A sent message reads in order inside its bubble: each quote, its note, then the message.
    const userParts = useMemo(
        () =>
            turn.isUser
                ? turn.items.flatMap((item) =>
                      item.kind === "part" && item.part.type === "text"
                          ? quotedMessageParts(item.part.text ?? "").map((part, at) => ({
                                key: `${item.index}:${at}`,
                                part,
                            }))
                          : [],
                  )
                : [],
        [turn.isUser, turn.items],
    )
    const writtenFiles = useMemo(() => turnFiles(activity.steps), [activity.steps])

    const body = turn.isUser ? (
        <div className="flex min-w-0 max-w-full flex-col gap-2">
            {userParts.map(({key, part}) =>
                part.kind === "quote" ? (
                    <UserQuoteBlock key={key} quote={part.quote} />
                ) : (
                    // Markdown, as the desktop bubble renders it: the composer's export is markdown.
                    <UserMarkdown key={key} text={part.text} />
                ),
            )}
        </div>
    ) : (
        <div className="flex min-w-0 max-w-full flex-col gap-3">
            <ActivityTimeline
                messageId={turn.message.id}
                clockId={runId}
                sessionId={sessionId}
                steps={activity.steps}
                streaming={live}
                answerStarted={answered}
                writing={writing}
                waitingOnUser={turn.isLast && waitingOnUser}
                resuming={turn.isLast && resuming}
                hadGate={turn.hadGate}
                sessionTurnStartedAt={sessionTurn.startedAt}
                sessionTurnDurationMs={sessionTurn.figures?.durationMs}
                streamedHere={streamedHereRef.current}
                runStartedAt={runStartedAt}
                renderClientTool={renderClientTool}
                failure={runError?.failure}
            />
            {answered ? (
                <div {...quoteProps} className="flex min-w-0 flex-col gap-3">
                    {activity.messages.map((message, at) => (
                        <AnswerReveal
                            key={message.index}
                            animate={live}
                            answer={at === activity.messages.length - 1}
                        >
                            <AssistantMarkdown
                                streaming={isLiveTextItem(turn, message.index)}
                                text={message.part.text}
                            />
                        </AnswerReveal>
                    ))}
                </div>
            ) : null}
            {/* After the messages: a server that did not join is what the turn came to. */}
            {mcpNotices.map((item) => (
                <McpServerNoticeCard key={`mcp-${item.index}`} notice={item.notice} />
            ))}
            {!live ? <TurnFiles files={writtenFiles} /> : null}
            {runError ? (
                <>
                    <RunErrorMessage paragraphs={runError.paragraphs} quote={runError.quote} />
                    <RunErrorRecovery actions={runError.recoveries} />
                </>
            ) : answerless && !traceSummary.isPending ? (
                <span className="text-xs italic text-colorTextSecondary">
                    No response — the agent ended its turn without answering.
                </span>
            ) : turn.status.stopped && !answered && !live ? (
                // Keyed on the answer the row shows, not on `hasAnswer`: a stop interrupts the
                // running call, the fold hides that failed call, and the turn would read empty.
                <span className="text-xs italic text-colorTextSecondary">Stopped</span>
            ) : null}
            {/* The turn's meta line sits under the answer, revealed on hover or focus like the
                desktop's; the row keeps its height so nothing shifts when it appears. Not while
                the run is parked on the reader: the turn is not over, only waiting. */}
            {!live && !(turn.isLast && (waitingOnUser || resuming)) ? (
                <div
                    className={`flex min-h-6 items-center gap-1 ${
                        inspectorEnabled ? "" : turnToolbarRevealClass
                    }`}
                >
                    <TurnFooter
                        {...footer}
                        isUser={false}
                        copyText={footer.copyText || runError?.paragraphs.join("\n\n")}
                        onRetry={runError?.onRetry}
                    />
                </div>
            ) : null}
        </div>
    )

    // Attachments hang above the bubble rather than inside its fill, so a message reads as its
    // files first and its words second. One strip per message, so the viewer pages through all.
    const files = useMemo(
        () =>
            turn.items.flatMap((item): AttachmentStripFile[] =>
                item.kind === "files"
                    ? item.parts.map((file) => ({
                          name: file.filename || file.mediaType || "attachment",
                          mediaType: file.mediaType ?? "",
                          src: file.url || undefined,
                          size: attachmentSize(file.providerMetadata),
                      }))
                    : [],
            ),
        [turn.items],
    )
    const header = files.length ? (
        <AttachmentStrip files={files} align={turn.isUser ? "end" : "start"} />
    ) : null
    // Attachments with no words paint no bubble; an assistant turn always paints its fold line.
    const hasBubbleContent =
        !turn.isUser ||
        turn.items.some(
            (item) => item.kind !== "files" && !(item.kind === "part" && item.part.type === "text"),
        ) ||
        userParts.length > 0 ||
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

    if (turn.hidden) return null

    return (
        <div
            className={`${mobileTurnRowClass} ${turn.isUser ? "justify-end" : "justify-start"}`}
            {...rowMarkers}
        >
            <ChatBubble
                placement={turn.isUser ? "end" : "start"}
                variant={turn.isUser && hasBubbleContent ? "filled" : "borderless"}
                // No avatar column; the 85% inset is what reads as a user bubble.
                className={
                    turn.isUser ? "min-w-0 max-w-[85%]" : "min-w-0 max-w-full sm:max-w-[85%]"
                }
                classNames={{
                    content: turn.isUser
                        ? cn(
                              userBubbleContentClass,
                              "rounded-xl rounded-br-sm bg-muted text-xs sm:px-3.5 sm:py-2.5",
                          )
                        : "min-w-0 max-w-full overflow-hidden text-xs",
                    body: "min-w-0 max-w-full overflow-hidden",
                }}
                // A refused file-only send has no words to paint, but its failure still has to be
                // said, or the cards sit there looking like an upload that worked.
                content={hasBubbleContent ? content : failureNote}
                header={header}
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
