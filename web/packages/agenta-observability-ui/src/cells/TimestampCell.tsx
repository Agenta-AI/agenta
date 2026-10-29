import {memo} from "react"

import {formattedTimestampAtomFamily} from "@agenta/observability"
import {useAtomValue} from "jotai"

export const TimestampCell = memo(({timestamp}: {timestamp?: string | number | null}) => {
    const formatted = useAtomValue(formattedTimestampAtomFamily(timestamp))
    return <div className="font-mono">{formatted}</div>
})

export default TimestampCell
