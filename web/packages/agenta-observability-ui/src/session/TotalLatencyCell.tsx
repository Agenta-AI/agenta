import {sessionLatencyAtomFamily, sessionsLoadingAtom} from "@agenta/observability"

import {DurationCell as DurationCellDisplay} from "../cells/DurationCell"
import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const TotalLatencyCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalLatency = useSessionAtomValue(sessionLatencyAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />

    return <DurationCellDisplay ms={totalLatency} />
}
