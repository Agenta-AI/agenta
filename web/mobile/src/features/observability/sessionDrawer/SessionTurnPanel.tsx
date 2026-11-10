import {useMemo, useState} from "react"

import type {TraceSpanNode} from "@agenta/observability"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {StatusRenderer} from "@agenta/observability-ui"
import {getTraceDrawerReferences, TraceAnnotations} from "@agenta/observability-ui/traceDrawer"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
    Badge,
    Button,
} from "@agenta/ui/ui"
import {ArrowSquareOut, Minus, Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {AddToTestsetDrawerButton} from "../addToTestset/AddToTestsetDrawerButton"
import {TraceAnnotateButton} from "../annotate/TraceAnnotateButton"

import {
    extractTurnMessages,
    hiddenMessageCount,
    readTraceMetrics,
    sessionTraceAnchorId,
    type TurnMessage,
} from "./sessionTurns"

const Message = ({message}: {message: TurnMessage}) => (
    <div className="flex flex-col gap-1 rounded-md bg-muted px-3 py-2">
        <span
            className={
                message.role === "exception"
                    ? "text-xs font-medium capitalize text-destructive"
                    : "text-xs font-medium capitalize text-muted-foreground"
            }
        >
            {message.role}
        </span>
        <p className="m-0 whitespace-pre-wrap break-words text-sm text-foreground">
            {message.content}
        </p>
    </div>
)

interface SessionTurnPanelProps {
    trace: TraceSpanNode
    /** Position in the session, from zero. */
    index: number
    annotationsVisible: boolean
    /** The annotations sit beside the messages, not under them. */
    annotationsBeside: boolean
}

/**
 * The turn's messages in developer mode: the trace drawer's message panel (view modes, the
 * readable view with copy and collapse per message), as the old app shows them.
 */
const MessagesPanel = ({messages}: {messages: TurnMessage[]}) => {
    const {TraceSpanDrillInView: Panel} = getTraceDrawerReferences()
    return <Panel title="messages" spanDataOverride={messages} viewModePreset="message" />
}

/** One trace as a collapsible panel: its messages, its totals, and its annotations. */
export const SessionTurnPanel = ({
    trace,
    index,
    annotationsVisible,
    annotationsBeside,
}: SessionTurnPanelProps) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    const [showHidden, setShowHidden] = useState(false)
    const messages = useMemo(() => extractTurnMessages(trace), [trace])
    const hidden = hiddenMessageCount(messages, index)
    const metrics = useMemo(() => readTraceMetrics(trace), [trace])

    return (
        <div id={sessionTraceAnchorId(trace.span_id)} className="scroll-mt-4">
            <Accordion type="multiple" defaultValue={["trace"]}>
                <AccordionItem value="trace">
                    <AccordionTrigger>
                        <span className="text-sm font-medium">Trace {index + 1}</span>
                    </AccordionTrigger>
                    <AccordionContent className="!p-0">
                        <div className={annotationsBeside ? "flex" : "flex flex-col"}>
                            <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                                {showHidden && !developerMode
                                    ? messages
                                          .slice(0, hidden)
                                          .map((message, position) => (
                                              <Message key={position} message={message} />
                                          ))
                                    : null}
                                {hidden > 0 ? (
                                    <div className="flex items-center gap-2">
                                        <div className="h-px flex-1 bg-border" />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setShowHidden(!showHidden)}
                                        >
                                            {showHidden ? <Minus size={12} /> : <Plus size={12} />}
                                            {showHidden
                                                ? "Hide first messages"
                                                : "Show all messages"}
                                        </Button>
                                        <div className="h-px flex-1 bg-border" />
                                    </div>
                                ) : null}
                                {developerMode ? (
                                    <MessagesPanel
                                        messages={showHidden ? messages : messages.slice(hidden)}
                                    />
                                ) : (
                                    messages
                                        .slice(hidden)
                                        .map((message, position) => (
                                            <Message key={hidden + position} message={message} />
                                        ))
                                )}
                                <div className="flex flex-wrap items-center gap-3">
                                    {developerMode ? (
                                        <StatusRenderer
                                            status={trace.status_code}
                                            message={trace.status_message}
                                        />
                                    ) : null}
                                    <ExecutionMetricsDisplay metrics={metrics} variant="plain" />
                                    <CopyTooltip copyText={trace.span_id} title="Copy span id">
                                        <Badge className="min-w-0 cursor-pointer font-mono">
                                            <span className="truncate"># {trace.span_id}</span>
                                        </Badge>
                                    </CopyTooltip>
                                    {/* Each turn's own actions, as in the old app. Each button
                                        checks its developer view and permission itself. */}
                                    {developerMode ? (
                                        <span className="ml-auto flex items-center gap-2">
                                            <AddToTestsetDrawerButton spanIds={[trace.span_id]} />
                                            <TraceAnnotateButton
                                                traceSpanIds={{
                                                    traceId: trace.trace_id,
                                                    spanId: trace.span_id,
                                                }}
                                                data={trace.annotations ?? []}
                                            />
                                        </span>
                                    ) : null}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className={developerMode ? undefined : "ml-auto"}
                                        onClick={() =>
                                            openTraceDrawer({
                                                traceId: trace.trace_id,
                                                activeSpanId: trace.span_id,
                                            })
                                        }
                                    >
                                        <ArrowSquareOut size={14} />
                                        View trace
                                    </Button>
                                </div>
                            </div>
                            {annotationsVisible ? (
                                <div
                                    className={
                                        annotationsBeside
                                            ? "w-[300px] shrink-0 border-0 border-l border-solid border-border p-4"
                                            : "border-0 border-t border-solid border-border p-4"
                                    }
                                >
                                    <TraceAnnotations annotations={trace.annotations ?? []} />
                                </div>
                            ) : null}
                        </div>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    )
}
