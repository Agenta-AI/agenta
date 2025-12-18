import {sessionCostAtomFamily} from "@/oss/state/newObservability/atoms/queries"
import {Skeleton} from "antd"
import {useAtomValue} from "jotai"
import CostCellDisplay from "../../../CostCell"

export const TotalCostCell = ({sessionId}: {sessionId: string}) => {
    const totalCost = useAtomValue(sessionCostAtomFamily(sessionId))

    if (totalCost === undefined) return <Skeleton active paragraph={{rows: 0}} />

    return <CostCellDisplay cost={totalCost} />
}
