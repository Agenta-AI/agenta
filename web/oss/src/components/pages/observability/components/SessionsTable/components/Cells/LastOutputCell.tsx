import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {SmartCellContent} from "@agenta/ui/cell-renderers"

import {sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {
    sessionLastOutputAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const LastOutputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const lastOutput = useSessionAtomValue(sessionLastOutputAtomFamily(sessionId))

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
            </div>
        )
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
