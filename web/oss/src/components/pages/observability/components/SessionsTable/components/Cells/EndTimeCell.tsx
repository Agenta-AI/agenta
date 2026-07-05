import {Skeleton} from "@agenta/primitive-ui/components/skeleton"

import {
    sessionTimeRangeAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import TimestampCell from "../../../TimestampCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const EndTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const {endTime} = useSessionAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
            </div>
        )
    if (!endTime) return <>-</>

    return <TimestampCell timestamp={endTime} />
}
