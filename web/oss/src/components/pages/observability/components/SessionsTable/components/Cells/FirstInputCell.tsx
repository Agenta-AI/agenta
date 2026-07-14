import {LastInputMessageCell} from "@agenta/ui/cell-renderers"
import {Skeleton} from "antd"

import {sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {
    sessionFirstInputAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

import {useSessionAtomValue} from "../../assets/sessionCellStore"

export const FirstInputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useSessionAtomValue(sessionsLoadingAtom)
    const firstInput = useSessionAtomValue(sessionFirstInputAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />
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
