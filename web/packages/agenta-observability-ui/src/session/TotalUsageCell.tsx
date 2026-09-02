import {sessionUsageAtomFamily, sessionsLoadingAtom} from "@agenta/observability"

import {UsageCell as UsageCellDisplay} from "../cells/UsageCell"
import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const TotalUsageCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const totalUsage = useSessionAtomValue(sessionUsageAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />

    return <UsageCellDisplay tokens={totalUsage} />
}
