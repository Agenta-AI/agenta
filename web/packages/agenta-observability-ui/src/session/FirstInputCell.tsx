import {sessionFirstInputAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {sanitizeDataWithBlobUrls} from "@agenta/shared/utils"
import {LastInputMessageCell} from "@agenta/ui/cell-renderers"

import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const FirstInputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const firstInput = useSessionAtomValue(sessionFirstInputAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />
    if (firstInput === undefined) return ""

    const {data: sanitized} = sanitizeDataWithBlobUrls(firstInput)
    return (
        <LastInputMessageCell
            value={sanitized}
            keyPrefix={`session-${sessionId}-input`}
            className="max-w-[300px] h-[112px] overflow-hidden"
        />
    )
}
