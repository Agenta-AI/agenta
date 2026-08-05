import {SmartCellContent} from "@agenta/ui/cell-renderers"
import {Skeleton} from "antd"

import {sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {
    sessionLastOutputAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const LastOutputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const lastOutput = useSessionAtomValue(sessionLastOutputAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />
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
