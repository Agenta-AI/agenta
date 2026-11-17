import {annotationSessionController} from "@agenta/annotation"
import {extractAgData, traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {getSpanDisplayOutputs, type TraceSpanNode} from "@agenta/observability"
import {sanitizeDataWithBlobUrls} from "@agenta/shared/utils"
import {LastInputMessageCell, SmartCellContent} from "@agenta/ui/cell-renderers"
import {useAtomValue} from "jotai"

const CELL_CLASS = "max-h-[88px] overflow-hidden"

/**
 * A trace item's inputs or outputs, as the traces table shows them: the last input message (or
 * the inputs), and the reply (or the outputs). Read from the trace's root span and its agent span.
 */
export const ScenarioTraceIOCell = ({
    scenarioId,
    part,
}: {
    scenarioId: string
    part: "inputs" | "outputs"
}) => {
    const {traceId} = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId || null))
    // A root agent span often has no outputs; use the reply the traces table shows.
    const value = !rootSpan
        ? null
        : part === "outputs"
          ? (getSpanDisplayOutputs(rootSpan as TraceSpanNode) ?? null)
          : (extractAgData(rootSpan)[part] ?? null)
    if (value === null) return <span className="text-[13px] text-muted-foreground">—</span>
    const {data} = sanitizeDataWithBlobUrls(value)
    return part === "inputs" ? (
        <LastInputMessageCell
            value={data}
            keyPrefix={`queue-input-${scenarioId}`}
            className={CELL_CLASS}
            maxLines={3}
        />
    ) : (
        <SmartCellContent
            value={data}
            keyPrefix={`queue-output-${scenarioId}`}
            maxLines={3}
            chatPreference="output"
            className={CELL_CLASS}
        />
    )
}
