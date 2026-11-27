import {sessionDurationAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {SkeletonBlock} from "@agenta/ui/ui"

import {DurationCell as DurationCellDisplay} from "../cells/DurationCell" // Reusing presentation

import {useSessionAtomValue} from "./sessionCellStore"

export const DurationCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const duration = useSessionAtomValue(sessionDurationAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />

    return <DurationCellDisplay ms={duration} />
}
