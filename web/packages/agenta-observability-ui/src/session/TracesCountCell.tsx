import {sessionTraceCountAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {SkeletonBlock} from "@agenta/ui/ui"

import {useSessionAtomValue} from "./sessionCellStore"

export const TracesCountCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const traceCount = useSessionAtomValue(sessionTraceCountAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />

    return <>{traceCount}</>
}
