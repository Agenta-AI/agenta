import {TooltipProps} from "antd"

export interface EnhancedTooltipProps {
    children: any
    title: string
    copyText?: string
    duration?: number
    tooltipProps?: TooltipProps
}
