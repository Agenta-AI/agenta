import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {
    sessionTraceCountAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

export const TracesCountCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const traceCount = useAtomValue(sessionTraceCountAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <>{traceCount}</>
}
