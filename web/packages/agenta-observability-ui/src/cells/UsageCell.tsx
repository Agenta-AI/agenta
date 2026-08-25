import {memo} from "react"

import {formattedUsageAtomFamily} from "@agenta/observability"
import {useAtomValue} from "jotai"

export const UsageCell = memo(({tokens}: {tokens?: number}) => {
    const formatted = useAtomValue(formattedUsageAtomFamily(tokens))
    return <div>{formatted}</div>
})

export default UsageCell
