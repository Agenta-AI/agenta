import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {
    sessionLatencyAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import DurationCellDisplay from "../../../DurationCell"

export const TotalLatencyCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const totalLatency = useAtomValue(sessionLatencyAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <DurationCellDisplay ms={totalLatency} />
}
