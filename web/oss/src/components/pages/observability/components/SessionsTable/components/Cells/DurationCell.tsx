import {Skeleton} from "@agenta/primitive-ui/components/skeleton"

import {
    sessionDurationAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import DurationCellDisplay from "../../../DurationCell" // Reusing presentation
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const DurationCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const duration = useSessionAtomValue(sessionDurationAtomFamily(sessionId))

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
            </div>
        )

    return <DurationCellDisplay ms={duration} />
}
