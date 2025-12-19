import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {sessionTraceCountAtomFamily} from "@/oss/state/newObservability/atoms/queries"

export const TracesCountCell = ({sessionId}: {sessionId: string}) => {
    const traceCount = useAtomValue(sessionTraceCountAtomFamily(sessionId))

    if (traceCount === undefined) return <Skeleton active paragraph={{rows: 0}} />

    return <>{traceCount}</>
}
