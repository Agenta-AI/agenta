import {sessionFirstInputAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {sanitizeDataWithBlobUrls} from "@agenta/shared/utils"
import {LastInputMessageCell} from "@agenta/ui/cell-renderers"
import {SkeletonBlock} from "@agenta/ui/ui"

import {ONE_LINE_MESSAGE_CELL} from "../cells/oneLineCell"

import {useSessionAtomValue} from "./sessionCellStore"

export const FirstInputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const firstInput = useSessionAtomValue(sessionFirstInputAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock className="max-w-[160px]" />
    if (firstInput === undefined) return ""

    const {data: sanitized} = sanitizeDataWithBlobUrls(firstInput)
    return (
        <LastInputMessageCell
            value={sanitized}
            keyPrefix={`session-${sessionId}-input`}
            maxLines={1}
            className={ONE_LINE_MESSAGE_CELL}
        />
    )
}
