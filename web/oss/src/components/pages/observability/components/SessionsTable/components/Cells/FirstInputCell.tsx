import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import LastInputMessageCell from "@/oss/components/pages/observability/components/common/LastInputMessageCell"
import {sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {
    sessionFirstInputAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

export const FirstInputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const firstInput = useAtomValue(sessionFirstInputAtomFamily(sessionId))

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
