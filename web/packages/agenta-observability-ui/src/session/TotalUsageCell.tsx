import {sessionUsageAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {SkeletonBlock} from "@agenta/ui/ui"

import {UsageCell as UsageCellDisplay} from "../cells/UsageCell"

import {useSessionAtomValue} from "./sessionCellStore"

export const TotalUsageCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalUsage = useSessionAtomValue(sessionUsageAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />

    return <UsageCellDisplay tokens={totalUsage} />
}
