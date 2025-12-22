import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {
    sessionUsageAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import UsageCellDisplay from "../../../UsageCell"

export const TotalUsageCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const totalUsage = useAtomValue(sessionUsageAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />

    return <UsageCellDisplay tokens={totalUsage} />
}
