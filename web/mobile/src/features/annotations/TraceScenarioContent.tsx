import {useMemo} from "react"

import {getTraceInputDisplayKeys, getTraceInputDisplayValue} from "@agenta/annotation"
import {toolStepsFromTrace} from "@agenta/chat/value-view"
import {
    extractAgData,
    traceEntityAtomFamily,
    traceRootSpanAtomFamily,
    type TraceSpan,
    type TracesApiResponse,
    type TracesResponse,
} from "@agenta/entities/trace"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {getSpanDisplayOutputs, type TraceSpanNode} from "@agenta/observability"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {InputsSection, OutputSection} from "./QueueValueSections"
import {ScenarioMessage} from "./ScenarioMessage"

/** The inputs of a span, as named fields, without the copies a nested `inputs` key repeats. */
export const spanInputFields = (inputs: Record<string, unknown> | null | undefined) =>
    getTraceInputDisplayKeys(inputs).map((name) => ({
        name,
        value: getTraceInputDisplayValue(inputs, name),
    }))

/**
 * The tool steps of each turn of a trace the trace entity query loaded. Its response is the trace
 * API's, the shape `toolStepsFromTrace` reads; only its `count` is optional there.
 */
export const traceTurnActivity = (trace: TracesApiResponse | null | undefined) =>
    toolStepsFromTrace(trace as TracesResponse | null | undefined)

const textOf = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)

/**
 * The failure a span recorded: its exception event's message, else its status message. Null for a
 * span that did not fail.
 */
export const spanErrorText = (span: TraceSpan): string | null => {
    const exception = span.events?.find((event) => event.name === "exception")
    const attributes = (exception?.attributes ?? {}) as Record<string, unknown>
    const failed = Boolean(exception) || span.status_code === "STATUS_CODE_ERROR"
    if (!failed) return null
    return (
        textOf(attributes["exception.message"]) ??
        textOf(span.status_message) ??
        textOf(attributes["exception.type"]) ??
        span.status_code ??
        "STATUS_CODE_ERROR"
    )
}

/** A trace read that gave no root span: the failure with Retry, or no data. */
export const TraceReadProblem = ({
    query,
    hasRoot,
}: {
    query: {isError: boolean; refetch: () => unknown}
    hasRoot: boolean
}) => {
    const t = useT(commonCatalog)
    if (query.isError) {
        return (
            <LoadError
                title="Failed to load trace data"
                description={null}
                retryLabel={t("common.retry")}
                onRetry={() => void query.refetch()}
            />
        )
    }
    return hasRoot ? null : <ScenarioMessage title="Trace data not available" />
}

/**
 * A trace item: the root span's inputs as rows, then its output drawn by its shape (a chat with
 * the tool steps of each turn, read from the trace's child spans).
 */
export const TraceScenarioContent = ({traceId}: {traceId: string}) => {
    const traceQuery = useAtomValue(traceEntityAtomFamily(traceId))
    const openTrace = useSetAtom(openTraceDrawerAtom)
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId))
    const turns = useMemo(() => traceTurnActivity(traceQuery.data), [traceQuery.data])

    if (traceQuery.isPending) {
        return (
            <div className="flex flex-col gap-3" role="status" aria-label="Loading the trace">
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-24" />
                <SkeletonBlock className="h-4 w-24" />
                <SkeletonBlock className="h-24" />
            </div>
        )
    }
    if (traceQuery.isError || !rootSpan) {
        return <TraceReadProblem query={traceQuery} hasRoot={Boolean(rootSpan)} />
    }
    const inputs = extractAgData(rootSpan).inputs as Record<string, unknown> | undefined
    const error = spanErrorText(rootSpan)
    return (
        <div className="flex flex-col gap-6">
            <InputsSection fields={spanInputFields(inputs)} />
            <OutputSection
                value={error ? null : getSpanDisplayOutputs(rootSpan as TraceSpanNode)}
                error={error}
                onOpenTrace={() => openTrace({traceId, activeSpanId: rootSpan.span_id})}
                turnActivity={turns}
            />
        </div>
    )
}
