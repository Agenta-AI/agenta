import {TooltipProps} from "antd"

export interface TooltipWithCopyActionProps {
    children: any
    title: string
    copyText?: string
    duration?: number
    tooltipProps?: TooltipProps
}
