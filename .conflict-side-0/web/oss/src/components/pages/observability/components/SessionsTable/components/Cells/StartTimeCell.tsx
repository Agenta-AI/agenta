import {Skeleton} from "antd"

import {
    sessionTimeRangeAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import TimestampCell from "../../../TimestampCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const StartTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const {startTime} = useSessionAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />
    if (!startTime) return <>-</>

    return <TimestampCell timestamp={startTime} />
}
