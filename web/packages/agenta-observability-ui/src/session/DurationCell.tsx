import {sessionDurationAtomFamily, sessionsLoadingAtom} from "@agenta/observability"

import {DurationCell as DurationCellDisplay} from "../cells/DurationCell" // Reusing presentation
import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const DurationCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const duration = useSessionAtomValue(sessionDurationAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />

    return <DurationCellDisplay ms={duration} />
}
