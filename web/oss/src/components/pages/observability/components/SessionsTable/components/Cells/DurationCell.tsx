import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {
    sessionDurationAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import DurationCellDisplay from "../../../DurationCell" // Reusing presentation

export const DurationCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const duration = useAtomValue(sessionDurationAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <DurationCellDisplay ms={duration} />
}
