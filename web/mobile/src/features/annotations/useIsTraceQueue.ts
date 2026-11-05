import {annotationSessionController} from "@agenta/annotation"
import {useAtomValue} from "jotai"

/**
 * True when the open queue holds traces. A test set queue ("testsets") and a test case queue
 * ("testcases") both hold test cases, so only "traces" is a trace queue.
 */
export const useIsTraceQueue = (): boolean =>
    useAtomValue(annotationSessionController.selectors.queueKind()) === "traces"
