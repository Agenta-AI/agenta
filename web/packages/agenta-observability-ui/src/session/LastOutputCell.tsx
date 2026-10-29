import {sessionLastOutputAtomFamily, sessionsLoadingAtom} from "@agenta/observability"
import {sanitizeDataWithBlobUrls} from "@agenta/shared/utils"
import {SmartCellContent} from "@agenta/ui/cell-renderers"

import {SkeletonBlock} from "../primitives/SkeletonBlock"

import {useSessionAtomValue} from "./sessionCellStore"

export const LastOutputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const lastOutput = useSessionAtomValue(sessionLastOutputAtomFamily(sessionId))

    if (isLoading) return <SkeletonBlock />
    if (lastOutput === undefined) return ""

    const {data: sanitized} = sanitizeDataWithBlobUrls(lastOutput)
    return (
        <SmartCellContent
            value={sanitized}
            keyPrefix={`session-${sessionId}-output`}
            maxLines={4}
            chatPreference="output"
            className="max-w-[300px] h-[112px] overflow-hidden"
        />
    )
}
