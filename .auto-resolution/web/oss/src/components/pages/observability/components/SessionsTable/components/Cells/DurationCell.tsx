import {Skeleton} from "antd"

import {
    sessionDurationAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import DurationCellDisplay from "../../../DurationCell" // Reusing presentation
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const DurationCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const duration = useSessionAtomValue(sessionDurationAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <DurationCellDisplay ms={duration} />
}
