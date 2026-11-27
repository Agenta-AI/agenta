import {sessionLatencyAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {SkeletonBlock} from "@agenta/ui/ui"

import {DurationCell as DurationCellDisplay} from "../cells/DurationCell"

import {useSessionAtomValue} from "./sessionCellStore"

export const TotalLatencyCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalLatency = useSessionAtomValue(sessionLatencyAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />

    return <DurationCellDisplay ms={totalLatency} />
}
