import * as React from "react"

import {Info} from "@phosphor-icons/react"

import {useIsTouch} from "../foundation/hooks/useWindowMatch"
import {cn} from "../foundation/utils/cn"

import {Popover, PopoverContent, PopoverTrigger} from "./popover"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "./tooltip"

export interface FieldHelpProps {
    /** The trigger's accessible name ("More information", "About Sandbox"). */
    label: string
    /** A heading over the help text, for help that names what it explains. */
    heading?: React.ReactNode
    /** The help text. */
    children: React.ReactNode
    /** The side the tooltip opens on; on touch the popover opens below. */
    side?: "top" | "right" | "bottom" | "left"
    className?: string
}

/** Field help (FORM-01): a tooltip with a mouse, a tap-to-open popover on touch (TOUCH-02); a 24px trigger everywhere (SIZE-02). */
export function FieldHelp({label, heading, children, side = "right", className}: FieldHelpProps) {
    const touch = useIsTouch()
    const [open, setOpen] = React.useState(false)

    const trigger = (
        <button
            type="button"
            data-slot="field-help"
            aria-label={label}
            onClick={touch ? undefined : () => setOpen((current) => !current)}
            className={cn(
                "-mx-1 -my-1 box-border inline-flex size-control-xs shrink-0 cursor-help items-center justify-center rounded-sm border-0 bg-transparent p-0 font-[inherit] text-muted-foreground transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-foreground focus-ring",
                className,
            )}
        >
            <Info className="size-3.5" aria-hidden="true" />
        </button>
    )
    const body = (
        <>
            {heading != null ? <span className="mb-0.5 block font-medium">{heading}</span> : null}
            <span className="block">{children}</span>
        </>
    )

    if (touch)
        return (
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                {/* Below the icon: a phone has no room at the side, and the shift keeps 16px from the edges. */}
                <PopoverContent
                    side="bottom"
                    align="start"
                    collisionPadding={16}
                    className="w-auto max-w-[min(280px,calc(100vw-32px))] px-3 py-2 text-body-sm text-foreground"
                >
                    {body}
                </PopoverContent>
            </Popover>
        )

    return (
        <TooltipProvider>
            <Tooltip open={open} onOpenChange={setOpen}>
                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                <TooltipContent side={side} className="max-w-[320px]">
                    {body}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
