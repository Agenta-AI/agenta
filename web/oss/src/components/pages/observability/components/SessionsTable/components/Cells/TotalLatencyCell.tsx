import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {sessionLatencyAtomFamily} from "@/oss/state/newObservability/atoms/queries"

import DurationCellDisplay from "../../../DurationCell"

export const TotalLatencyCell = ({sessionId}: {sessionId: string}) => {
    const totalLatency = useAtomValue(sessionLatencyAtomFamily(sessionId))

    if (totalLatency === undefined) return <Skeleton active paragraph={{rows: 0}} />

    return <DurationCellDisplay ms={totalLatency} />
}
