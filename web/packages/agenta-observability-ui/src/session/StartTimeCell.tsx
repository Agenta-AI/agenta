import {sessionTimeRangeAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {SkeletonBlock} from "@agenta/ui/ui"

import {TimestampCell} from "../cells/TimestampCell"

import {useSessionAtomValue} from "./sessionCellStore"

export const StartTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const {startTime} = useSessionAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />
    if (!startTime) return <>—</>

    return <TimestampCell timestamp={startTime} />
}
