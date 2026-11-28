import {useMemo} from "react"

import {
    annotationSessionController,
    scenarioStatusLabel,
    scenarioStatusTone,
    truncateScenarioId,
} from "@agenta/annotation"
import {valueAsText} from "@agenta/chat/value-view"
import {
    groupTraceTurns,
    traceEntityAtomFamily,
    traceRootSpanAtomFamily,
    type TraceSpan,
} from "@agenta/entities/trace"
import {timeAgo} from "@agenta/shared/utils"
import {cn} from "@agenta/ui/ui"
import {CheckCircle, Circle, Warning} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {RUN_STATUS_DOT_COLOR} from "@/features/evaluations/list/runStatusDotColor"

import {useInView} from "./useInView"
import {firstTestcaseInput} from "./useScenarioRows"

/**
 * The status as an icon, its word in the title: done, failed, running (the run status dot), or
 * waiting for a review.
 */
const StatusIcon = ({status}: {status: string | null}) => {
    const tone = scenarioStatusTone(status)
    const label = scenarioStatusLabel(status)
    return (
        <span title={label} className="flex h-4.5 w-3.5 shrink-0 items-center justify-center">
            {tone === "success" ? (
                <CheckCircle aria-label={label} size={14} className="text-success" />
            ) : tone === "error" ? (
                <Warning aria-label={label} size={14} className="text-destructive" />
            ) : tone === "processing" ? (
                <span
                    role="img"
                    aria-label={label}
                    className={cn("size-1.5 rounded-round", RUN_STATUS_DOT_COLOR[tone])}
                />
            ) : (
                <Circle aria-label={label} size={14} className="text-muted-foreground" />
            )}
        </span>
    )
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

/** A trace's first user message, else its root span name. */
const useTraceText = (traceId: string) => {
    const query = useAtomValue(traceEntityAtomFamily(traceId || null))
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId || null))
    const firstUserText = useMemo(() => {
        const spans = Object.values(query.data?.traces ?? {}).flatMap((entry) =>
            Object.values((entry.spans ?? {}) as Record<string, TraceSpan>),
        )
        return spans.length > 0 ? groupTraceTurns(spans)[0]?.userText : null
    }, [query.data])
    return firstUserText ?? rootSpan?.span_name ?? null
}

/** A test case's first input. */
const useTestcaseText = (testcaseId: string) => {
    const query = useAtomValue(annotationSessionController.selectors.testcaseData(testcaseId))
    const input = firstTestcaseInput(query.data?.data)
    return input === undefined || input === null ? null : valueAsText(input)
}

/**
 * One item of the list: its status, what it is (a trace's first user message, a test case's
 * first input), its short id and its age. A run's item reads its test case.
 */
export const QueueItemRow = ({
    scenarioId,
    status,
    createdAt,
    selected,
    onOpen,
}: {
    scenarioId: string
    status: string | null
    createdAt: string | null
    selected: boolean
    onOpen: () => void
}) => {
    // A row reads its references, trace or test case only once it nears the viewport: a long
    // queue does not load every item (in a run's queue, its step results too) to draw one line.
    const {ref, inView} = useInView<HTMLButtonElement>()
    const readId = inView ? scenarioId : ""
    const {traceId} = useAtomValue(annotationSessionController.selectors.scenarioTraceRef(readId))
    const {testcaseId} = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(readId),
    )
    const testcaseText = useTestcaseText(testcaseId)
    const traceText = useTraceText(testcaseId ? "" : traceId)
    const text = oneLine((testcaseId ? testcaseText : traceText) ?? "") || "—"
    const shortId = truncateScenarioId(testcaseId || traceId || scenarioId)
    const age = createdAt ? timeAgo(Date.parse(createdAt)) : ""

    return (
        <button
            ref={ref}
            type="button"
            aria-current={selected ? "true" : undefined}
            onClick={onOpen}
            className="focus-ring flex w-full cursor-pointer items-start gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-accent aria-[current=true]:bg-selected"
        >
            <StatusIcon status={status} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-body text-foreground" title={text}>
                    {text}
                </span>
                <span className="truncate font-mono text-code-sm text-muted-foreground">
                    {age ? `${shortId} · ${age}` : shortId}
                </span>
            </span>
        </button>
    )
}
