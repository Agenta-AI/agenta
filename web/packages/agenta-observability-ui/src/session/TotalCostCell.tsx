import {sessionCostAtomFamily, sessionsLoadingAtom} from "@agenta/observability"

import {CostCell as CostCellDisplay} from "../cells/CostCell"
import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const TotalCostCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalCost = useSessionAtomValue(sessionCostAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />

    return <CostCellDisplay cost={totalCost} />
}
