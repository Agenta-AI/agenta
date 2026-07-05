import {Skeleton} from "@agenta/primitive-ui/components/skeleton"

import {
    sessionUsageAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import UsageCellDisplay from "../../../UsageCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const TotalUsageCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalUsage = useSessionAtomValue(sessionUsageAtomFamily(sessionId))

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
            </div>
        )

    return <UsageCellDisplay tokens={totalUsage} />
}
