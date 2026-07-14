import {Skeleton} from "antd"

import {
    sessionLatencyAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import DurationCellDisplay from "../../../DurationCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const TotalLatencyCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalLatency = useSessionAtomValue(sessionLatencyAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <DurationCellDisplay ms={totalLatency} />
}
