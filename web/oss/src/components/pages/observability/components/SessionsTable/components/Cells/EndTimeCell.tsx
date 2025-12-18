import {sessionTimeRangeAtomFamily} from "@/oss/state/newObservability/atoms/queries"
import {Skeleton} from "antd"
import {useAtomValue} from "jotai"
import TimestampCell from "../../../TimestampCell"

export const EndTimeCell = ({sessionId}: {sessionId: string}) => {
    const {endTime} = useAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (!endTime) return <Skeleton active paragraph={{rows: 0}} />

    return <TimestampCell timestamp={endTime} />
}
