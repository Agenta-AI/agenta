import {Tag} from "antd"

import TooltipWithCopyAction from "@/oss/components/EnhancedUIs/Tooltip"

export const SessionIdCell = ({sessionId}: {sessionId: string}) => {
    return (
        <TooltipWithCopyAction copyText={sessionId || ""} title="Copy session id">
            <Tag className="font-mono bg-[#0517290F] w-fit truncate" bordered={false}>
                # {sessionId}
            </Tag>
        </TooltipWithCopyAction>
    )
}
