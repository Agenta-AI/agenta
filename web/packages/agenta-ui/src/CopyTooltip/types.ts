/**
 * Local, antd-free stand-in for antd `TooltipProps` (only the surface call-sites pass).
 * Kept structurally compatible so an antd `TooltipProps` object still assigns — the
 * component translates what Radix expresses and drops the antd-only bits.
 */
export interface CopyTooltipOverlayProps {
    title?: React.ReactNode
    /** antd placement (12-way); translated to Radix `side` + `align`. */
    placement?: string
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    /** Seconds, antd-style; translated to Radix `delayDuration` (ms). */
    mouseEnterDelay?: number
    mouseLeaveDelay?: number
    /** antd renders an arrow by default; our TooltipContent always does. Accepted, unused. */
    arrow?: boolean | {pointAtCenter?: boolean}
    overlayClassName?: string
    className?: string
    [key: string]: unknown
}

interface CopyTooltipChildProps {
    className?: string
    onClick?: (event: React.MouseEvent<HTMLElement>) => void
}

export interface CopyTooltipProps {
    children: React.ReactElement<CopyTooltipChildProps>
    title: string
    copyText?: string
    duration?: number
    tooltipProps?: CopyTooltipOverlayProps
}
