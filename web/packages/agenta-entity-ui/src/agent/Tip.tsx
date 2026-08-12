import type {ReactNode} from "react"

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"

/** Radix tooltip in antd's ergonomic shape (`title` + child). No title → just the child. */
export const Tip = ({
    title,
    side,
    children,
}: {
    title: ReactNode
    side?: "top" | "right" | "bottom" | "left"
    children: ReactNode
}) => {
    if (title == null) return <>{children}</>
    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent side={side}>{title}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
