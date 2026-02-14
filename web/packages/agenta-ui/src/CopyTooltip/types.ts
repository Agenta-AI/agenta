import {TooltipProps} from "antd"

export interface CopyTooltipProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: React.ReactElement<any>
    title: string
    copyText?: string
    duration?: number
    tooltipProps?: TooltipProps
}
