import {annotationSessionController} from "@agenta/annotation"
import {extractAgData, traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {sanitizeDataWithBlobUrls} from "@agenta/shared/utils"
import {LastInputMessageCell, SmartCellContent} from "@agenta/ui/cell-renderers"
import {useAtomValue} from "jotai"

const CELL_CLASS = "max-h-[88px] overflow-hidden"

/**
 * A trace item's inputs or outputs, as the traces table shows them: the last input message (or
 * the inputs), and the reply (or the outputs). Read from the trace's root span.
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
    const value = rootSpan ? (extractAgData(rootSpan)[part] ?? null) : null
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
