import {sessionUsageAtomFamily} from "@/oss/state/newObservability/atoms/queries"
import {Skeleton} from "antd"
import {useAtomValue} from "jotai"
import UsageCellDisplay from "../../../UsageCell"

export const TotalUsageCell = ({sessionId}: {sessionId: string}) => {
    const totalUsage = useAtomValue(sessionUsageAtomFamily(sessionId))

    if (totalUsage === undefined) return <Skeleton active paragraph={{rows: 0}} />

    return <UsageCellDisplay tokens={totalUsage} />
}
