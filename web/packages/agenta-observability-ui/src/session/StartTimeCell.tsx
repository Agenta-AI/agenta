import {sessionTimeRangeAtomFamily, sessionsLoadingAtom} from "@agenta/observability"

import {TimestampCell} from "../cells/TimestampCell"
import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const StartTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const {startTime} = useSessionAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />
    if (!startTime) return <>-</>

    return <TimestampCell timestamp={startTime} />
}
