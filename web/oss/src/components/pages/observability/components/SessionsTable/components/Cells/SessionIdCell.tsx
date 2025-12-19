import {Tag} from "antd"

import TooltipWithCopyAction from "@/oss/components/EnhancedUIs/Tooltip"

export const SessionIdCell = ({sessionId}: {sessionId: string}) => {
    const shortId = sessionId ? sessionId.split("-")[0] : "-"
    return (
        <TooltipWithCopyAction copyText={sessionId || ""} title="Copy session id">
            <Tag className="font-mono bg-[#0517290F]" bordered={false}>
                # {shortId}
            </Tag>
        </TooltipWithCopyAction>
    )
}
