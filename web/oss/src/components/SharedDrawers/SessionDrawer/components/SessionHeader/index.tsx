import {CaretUp, CaretDown, SidebarSimple} from "@phosphor-icons/react"
import {Button, Tag, Typography} from "antd"
import {useAtom} from "jotai"

import TooltipWithCopyAction from "@/oss/components/EnhancedUIs/Tooltip"

import {isAnnotationVisibleAtom} from "../../store/sessionDrawerStore"

import {getTraceIdFromNode} from "./assets/helper"
import {SessionHeaderProps} from "./assets/types"

const SessionHeader = ({}: SessionHeaderProps) => {
    const [isAnnotationVisible, setIsAnnotationVisible] = useAtom(isAnnotationVisibleAtom)
    const displayTrace = "something"

    return (
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="flex gap-1">
                    <Button type="text" icon={<CaretUp size={16} />} />
                    <Button type="text" icon={<CaretDown size={16} />} />
                </div>

                <Typography.Text className="text-sm font-medium">Session</Typography.Text>
                <TooltipWithCopyAction
                    copyText={getTraceIdFromNode(displayTrace) || ""}
                    title="Copy trace id"
                >
                    <Tag className="font-mono bg-[#0517290F]" bordered={false}>
                        # {getTraceIdFromNode(displayTrace) || "-"}
                    </Tag>
                </TooltipWithCopyAction>
            </div>

            <Button
                size="small"
                type={!isAnnotationVisible ? "primary" : "default"}
                icon={<SidebarSimple size={14} />}
                onClick={() => setIsAnnotationVisible(!isAnnotationVisible)}
            >
                {!isAnnotationVisible ? "Show" : "Hide"} annotations
            </Button>
        </div>
    )
}

export default SessionHeader
