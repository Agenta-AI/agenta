import {Skeleton} from "antd"

import {
    sessionTimeRangeAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import TimestampCell from "../../../TimestampCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const EndTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const {endTime} = useSessionAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />
    if (!endTime) return <>-</>

    return <TimestampCell timestamp={endTime} />
}
