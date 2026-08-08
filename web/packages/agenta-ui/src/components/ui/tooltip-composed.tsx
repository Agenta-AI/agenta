import * as React from "react"

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "./tooltip"

export interface SimpleTooltipProps {
    /** Tooltip body. Empty/undefined renders the child bare — antd `Tooltip title` semantics. */
    title?: React.ReactNode
    side?: React.ComponentProps<typeof TooltipContent>["side"]
    className?: string
    /** Must accept a forwarded ref (the trigger renders asChild). */
    children: React.ReactElement
}

/**
 * The one-liner tooltip — antd's `<Tooltip title>` shape over the Radix primitive, for the
 * common label-on-hover case. Compose the parts directly when you need controlled open state,
 * custom delays, or portalling into a specific container.
 */
export function SimpleTooltip({title, side, className, children}: SimpleTooltipProps) {
    if (title == null || title === "") return children
    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent side={side} className={className}>
                    {title}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
