import {useMemo} from "react"

import {getTraceInputDisplayKeys, getTraceInputDisplayValue} from "@agenta/annotation"
import {toolStepsFromTrace} from "@agenta/chat/value-view"
import {
    extractAgData,
    traceEntityAtomFamily,
    traceRootSpanAtomFamily,
    type TracesApiResponse,
    type TracesResponse,
} from "@agenta/entities/trace"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {getSpanDisplayOutputs, type TraceSpanNode} from "@agenta/observability"
import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

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

/**
 * A trace item: the root span's inputs as rows, then its output drawn by its shape (a chat with
 * the tool steps of each turn, read from the trace's child spans).
 */
export const TraceScenarioContent = ({traceId}: {traceId: string}) => {
    const t = useT(commonCatalog)
    const traceQuery = useAtomValue(traceEntityAtomFamily(traceId))
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
    if (traceQuery.isError) {
        return (
            <LoadError
                title="Failed to load trace data"
                description={null}
                retryLabel={t("common.retry")}
                onRetry={() => void traceQuery.refetch()}
            />
        )
    }
    if (!rootSpan) return <ScenarioMessage title="Trace data not available" />
    const inputs = extractAgData(rootSpan).inputs as Record<string, unknown> | undefined
    return (
        <div className="flex flex-col gap-6">
            <InputsSection fields={spanInputFields(inputs)} />
            <OutputSection
                value={getSpanDisplayOutputs(rootSpan as TraceSpanNode)}
                turnActivity={turns}
            />
        </div>
    )
}
