import {useMemo, useState} from "react"

import type {TraceSpanNode} from "@agenta/observability"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {TraceAnnotations} from "@agenta/observability-ui/traceDrawer"
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
import {useSetAtom} from "jotai"

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
    /** Annotations sit under the messages instead of beside them. */
    narrow: boolean
}

/** One trace as a collapsible panel: its messages, its totals, and its annotations. */
export const SessionTurnPanel = ({
    trace,
    index,
    annotationsVisible,
    narrow,
}: SessionTurnPanelProps) => {
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
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
                        <div className={narrow ? "flex flex-col" : "flex"}>
                            <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                                {showHidden
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
                                {messages.slice(hidden).map((message, position) => (
                                    <Message key={hidden + position} message={message} />
                                ))}
                                <div className="flex flex-wrap items-center gap-3">
                                    <ExecutionMetricsDisplay metrics={metrics} variant="plain" />
                                    <CopyTooltip copyText={trace.span_id} title="Copy span id">
                                        <Badge className="min-w-0 cursor-pointer font-mono">
                                            <span className="truncate"># {trace.span_id}</span>
                                        </Badge>
                                    </CopyTooltip>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="ml-auto"
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
                                        narrow
                                            ? "border-0 border-t border-solid border-border p-4"
                                            : "w-[300px] shrink-0 border-0 border-l border-solid border-border p-4"
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
