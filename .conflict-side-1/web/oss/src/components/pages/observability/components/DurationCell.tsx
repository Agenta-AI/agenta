import {memo} from "react"

import {useAtomValue} from "jotai"

import {formattedDurationAtomFamily} from "@/oss/state/newObservability"

interface Props {
    ms?: number
}

const DurationCell = memo(({ms}: Props) => {
    const formatted = useAtomValue(formattedDurationAtomFamily(ms))
    return <div>{formatted}</div>
})

export default DurationCell
