import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {sessionTimeRangeAtomFamily} from "@/oss/state/newObservability/atoms/queries"

import TimestampCell from "../../../TimestampCell"

export const StartTimeCell = ({sessionId}: {sessionId: string}) => {
    const {startTime} = useAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (!startTime) return <Skeleton active paragraph={{rows: 0}} />

    return <TimestampCell timestamp={startTime} />
}
