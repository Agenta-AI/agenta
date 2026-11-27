import {sessionTimeRangeAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {SkeletonBlock} from "@agenta/ui/ui"

import {TimestampCell} from "../cells/TimestampCell"

import {useSessionAtomValue} from "./sessionCellStore"

export const EndTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const {endTime} = useSessionAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />
    if (!endTime) return <>—</>

    return <TimestampCell timestamp={endTime} />
}
