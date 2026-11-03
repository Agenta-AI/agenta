import {annotationSessionController} from "@agenta/annotation"
import {traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {useAtomValue, useSetAtom} from "jotai"

import {useIsTraceQueue} from "./useIsTraceQueue"

/**
 * Opens an item's trace in the global trace drawer, at its root span. Null for a test case queue
 * or an item without a trace yet.
 */
export const useScenarioTraceOpener = (scenarioId: string): (() => void) | null => {
    const isTraces = useIsTraceQueue()
    const {traceId} = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(isTraces && traceId ? traceId : null))
    const openTrace = useSetAtom(openTraceDrawerAtom)
    if (!isTraces || !traceId) return null
    return () => openTrace({traceId, activeSpanId: rootSpan?.span_id ?? null})
}
