import {sessionLastOutputAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {sanitizeDataWithBlobUrls} from "@agenta/shared/utils"
import {SmartCellContent} from "@agenta/ui/cell-renderers"
import {SkeletonBlock} from "@agenta/ui/ui"

import {ONE_LINE_CELL} from "../cells/oneLineCell"

import {useSessionAtomValue} from "./sessionCellStore"

export const LastOutputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const lastOutput = useSessionAtomValue(sessionLastOutputAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />
    if (lastOutput === undefined) return ""

    const {data: sanitized} = sanitizeDataWithBlobUrls(lastOutput)
    return (
        <SmartCellContent
            value={sanitized}
            keyPrefix={`session-${sessionId}-output`}
            maxLines={1}
            chatPreference="output"
            className={ONE_LINE_CELL}
        />
    )
}
