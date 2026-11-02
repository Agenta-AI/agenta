import {sessionTimeRangeAtomFamily, sessionsLoadingAtom} from "@agenta/observability"

import {TimestampCell} from "../cells/TimestampCell"
import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const EndTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const {endTime} = useSessionAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />
    if (!endTime) return <>-</>

    return <TimestampCell timestamp={endTime} />
}
