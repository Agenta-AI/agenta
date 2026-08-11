import {Skeleton} from "antd"

import {
    sessionCostAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import CostCellDisplay from "../../../CostCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const TotalCostCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalCost = useSessionAtomValue(sessionCostAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <CostCellDisplay cost={totalCost} />
}
