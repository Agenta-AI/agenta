import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {
    sessionCostAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import CostCellDisplay from "../../../CostCell"

export const TotalCostCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const totalCost = useAtomValue(sessionCostAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <CostCellDisplay cost={totalCost} />
}
