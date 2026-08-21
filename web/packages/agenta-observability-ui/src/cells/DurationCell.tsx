import {memo} from "react"

import {formattedDurationAtomFamily} from "@agenta/observability"
import {useAtomValue} from "jotai"

export const DurationCell = memo(({ms}: {ms?: number}) => {
    const formatted = useAtomValue(formattedDurationAtomFamily(ms))
    return <div>{formatted}</div>
})

export default DurationCell
