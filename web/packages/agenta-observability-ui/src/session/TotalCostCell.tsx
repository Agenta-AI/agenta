import {sessionCostAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {SkeletonBlock} from "@agenta/ui/ui"

import {CostCell as CostCellDisplay} from "../cells/CostCell"

import {useSessionAtomValue} from "./sessionCellStore"

export const TotalCostCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalCost = useSessionAtomValue(sessionCostAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />

    return <CostCellDisplay cost={totalCost} />
}
