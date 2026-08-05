import {memo} from "react"

import {useAtomValue} from "jotai"

import {formattedUsageAtomFamily} from "@/oss/state/newObservability"

interface Props {
    tokens?: number
}

const UsageCell = memo(({tokens}: Props) => {
    const formatted = useAtomValue(formattedUsageAtomFamily(tokens))
    return <div>{formatted}</div>
})

export default UsageCell
