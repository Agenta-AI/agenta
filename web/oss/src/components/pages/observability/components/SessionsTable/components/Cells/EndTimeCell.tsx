import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {
    sessionTimeRangeAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import TimestampCell from "../../../TimestampCell"

export const EndTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const {endTime} = useAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />
    if (!endTime) return <>-</>

    return <TimestampCell timestamp={endTime} />
}
