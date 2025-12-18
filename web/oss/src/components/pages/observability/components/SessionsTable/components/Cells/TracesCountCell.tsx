import {sessionTraceCountAtomFamily} from "@/oss/state/newObservability/atoms/queries"
import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

export const TracesCountCell = ({sessionId}: {sessionId: string}) => {
    const traceCount = useAtomValue(sessionTraceCountAtomFamily(sessionId))

    if (traceCount === undefined) return <Skeleton active paragraph={{rows: 0}} />

    return <>{traceCount}</>
}
