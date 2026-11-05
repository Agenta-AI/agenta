import {annotationSessionController} from "@agenta/annotation"
import {useAtomValue} from "jotai"

/** True when the queue's items are traces: a trace queue, or a query queue that collects them. */
export const useIsTraceQueue = (): boolean => {
    const kind = useAtomValue(annotationSessionController.selectors.queueKind())
    return kind === "traces" || kind === "queries"
}
