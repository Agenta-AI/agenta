import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {
    sessionTimeRangeAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import TimestampCell from "../../../TimestampCell"

export const StartTimeCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const {startTime} = useAtomValue(sessionTimeRangeAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />
    if (!startTime) return <>-</>

    return <TimestampCell timestamp={startTime} />
}
