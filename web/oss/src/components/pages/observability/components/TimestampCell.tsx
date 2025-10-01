import {memo} from "react"

import {useAtomValue} from "jotai"

import {formattedTimestampAtomFamily} from "@/oss/state/newObservability"

interface Props {
    timestamp?: string
}

const TimestampCell = memo(({timestamp}: Props) => {
    const formatted = useAtomValue(formattedTimestampAtomFamily(timestamp))
    return <div className="font-mono">{formatted}</div>
})

export default TimestampCell
