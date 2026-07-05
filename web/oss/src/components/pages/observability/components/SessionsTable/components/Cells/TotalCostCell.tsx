import {Skeleton} from "@agenta/primitive-ui/components/skeleton"

import {
    sessionCostAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import CostCellDisplay from "../../../CostCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const TotalCostCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalCost = useSessionAtomValue(sessionCostAtomFamily(sessionId))

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
            </div>
        )

    return <CostCellDisplay cost={totalCost} />
}
