import {TooltipProps} from "antd"

interface CopyTooltipChildProps {
    className?: string
    onClick?: (event: React.MouseEvent<HTMLElement>) => void
}

export interface CopyTooltipProps {
    children: React.ReactElement<CopyTooltipChildProps>
    title: string
    copyText?: string
    duration?: number
    tooltipProps?: TooltipProps
}
