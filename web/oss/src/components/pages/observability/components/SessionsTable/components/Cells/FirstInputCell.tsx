import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import {getStringOrJson, sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"
import {sessionFirstInputAtomFamily} from "@/oss/state/newObservability/atoms/queries"

export const FirstInputCell = ({sessionId}: {sessionId: string}) => {
    const firstInput = useAtomValue(sessionFirstInputAtomFamily(sessionId))

    if (firstInput === undefined) return <Skeleton active paragraph={{rows: 0}} />

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
