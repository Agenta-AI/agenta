import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {sessionDurationAtomFamily} from "@/oss/state/newObservability/atoms/queries"

import DurationCellDisplay from "../../../DurationCell" // Reusing presentation

export const DurationCell = ({sessionId}: {sessionId: string}) => {
    const duration = useAtomValue(sessionDurationAtomFamily(sessionId))

    if (duration === undefined) return <Skeleton active paragraph={{rows: 0}} />

    return <DurationCellDisplay ms={duration} />
}
