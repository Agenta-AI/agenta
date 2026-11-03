import {annotationSessionController} from "@agenta/annotation"
import {useAtomValue} from "jotai"

/** True when the open queue holds traces. Only a test case queue is not a trace queue. */
export const useIsTraceQueue = (): boolean =>
    useAtomValue(annotationSessionController.selectors.queueKind()) !== "testcases"
