import {useCallback} from "react"

import {canViewSpansAtom} from "@agenta/entities/access"
import {useAtomValue} from "jotai"

import {PlaygroundTraceFooter} from "./PlaygroundTraceFooter"

/** The trace footer for an output, or undefined when the user cannot view traces. */
export const usePlaygroundTraceFooter = () => {
    const canViewSpans = useAtomValue(canViewSpansAtom)
    const renderTraceFooter = useCallback(
        (traceId: string) => <PlaygroundTraceFooter traceId={traceId} />,
        [],
    )
    return canViewSpans ? renderTraceFooter : undefined
}
