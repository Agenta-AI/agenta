import {sessionTraceCountAtomFamily, sessionsLoadingAtom} from "@agenta/observability"

import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const TracesCountCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const traceCount = useSessionAtomValue(sessionTraceCountAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />

    return <>{traceCount}</>
}
