import {Skeleton} from "antd"

import {
    sessionUsageAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import UsageCellDisplay from "../../../UsageCell"
import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const TotalUsageCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalUsage = useSessionAtomValue(sessionUsageAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <UsageCellDisplay tokens={totalUsage} />
}
