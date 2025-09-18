import {memo} from "react"

import {useAtomValue} from "jotai"

import {formattedCostAtomFamily} from "@/oss/state/newObservability"

interface Props {
    cost?: number
}

const CostCell = memo(({cost}: Props) => {
    const formatted = useAtomValue(formattedCostAtomFamily(cost))
    return <div>{formatted}</div>
})

export default CostCell
