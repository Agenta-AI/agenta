import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import TruncatedTooltipTag from "@/oss/components/TruncatedTooltipTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {
    sessionLastOutputAtomFamily,
    sessionsLoadingAtom,
} from "@/oss/state/newObservability/atoms/queries"

export const LastOutputCell = ({sessionId}: {sessionId: string}) => {
    const isLoading = useAtomValue(sessionsLoadingAtom)
    const lastOutput = useAtomValue(sessionLastOutputAtomFamily(sessionId))

    if (isLoading) return <Skeleton active paragraph={{rows: 0}} />
    if (lastOutput === undefined) return ""

    return (
        <TruncatedTooltipTag
            children={lastOutput ? getStringOrJson(lastOutput) : ""}
            placement="bottom"
            tagProps={{
                className: "max-w-[300px] truncate",
            }}
        />
    )
}
