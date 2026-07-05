import {Skeleton} from "@agenta/primitive-ui/components/skeleton"

import {
    sessionLatencyAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import DurationCellDisplay from "../../../DurationCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const TotalLatencyCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalLatency = useSessionAtomValue(sessionLatencyAtomFamily(sessionId))

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
            </div>
        )

    return <DurationCellDisplay ms={totalLatency} />
}
