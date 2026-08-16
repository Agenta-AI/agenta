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
 *
 * Prefer not to hand this a child that is itself an `asChild` Radix trigger (`PopoverTrigger`,
 * `DropdownMenuTrigger`, …): both collapse onto one element and Radix composes their refs into
 * one nested chain. Wrap the inner trigger in a `<span className="inline-flex">` instead —
 * focus still reaches the tooltip, because React's `onFocus` bubbles from the child.
 *
 * Two things are known and worth not relearning:
 * - Wrapping here for EVERY caller was tried and reverted. The span becomes the flex item, so
 *   children relying on being one themselves (`ml-auto`, `min-w-0`, `truncate`) break.
 * - This trigger IS implicated in the `/evaluations` "Maximum update depth exceeded" loop:
 *   stubbing SimpleTooltip to render `children` bare makes the page render. But un-nesting the
 *   three trigger-in-trigger call sites did NOT fix it, so the nesting is not the mechanism.
 *   The live crash detaches a composed ref chain that ends in a `setState`
 *   (`dispatchSetState ← setRef ← … ← safelyDetachRef ← commitDeletionEffectsOnFiber`).
 *   Unresolved — do not assume the un-nesting above closed it.
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
