import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import {getStringOrJson, sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
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
        <TruncatedTooltipTag
            children={firstInput ? getStringOrJson(sanitized) : ""}
            placement="bottom"
            tagProps={{
                className: "max-w-[300px] truncate",
            }}
        />
    )
}
