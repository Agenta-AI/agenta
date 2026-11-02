import {memo} from "react"

import {formattedCostAtomFamily} from "@agenta/observability"
import {useAtomValue} from "jotai"

export const CostCell = memo(({cost}: {cost?: number}) => {
    const formatted = useAtomValue(formattedCostAtomFamily(cost))
    return <div>{formatted}</div>
})

export default CostCell
