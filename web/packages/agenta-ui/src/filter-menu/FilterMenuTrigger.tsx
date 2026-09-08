import type {ReactNode} from "react"

import {Button} from "../components/ui/button"
import {PopoverTrigger} from "../components/ui/popover"
import {cn} from "../components/ui/utils"

import type {FilterMenuTriggerProps} from "./types"

/**
 * The button both menus open from.
 *
 * `label={null}` collapses it to the glyph alone — the shape a dense toolbar wants — which is why
 * the size flips to the icon variant rather than leaving an empty text box behind. The active
 * count still rides along there: an icon-only trigger has even less room to say a view is
 * narrowed.
 */
export const FilterMenuTrigger = ({
    label,
    icon,
    size = "sm",
    variant = "outline",
    triggerClassName,
    triggerAriaLabel,
    activeCount = 0,
    defaultLabel,
}: FilterMenuTriggerProps & {icon: ReactNode; defaultLabel: string}) => {
    const text = label === undefined ? defaultLabel : label
    const iconOnly = text === null || text === "" || text === false
    const iconSize = size === "sm" || size === "icon-sm" ? "icon-sm" : "icon"

    return (
        <PopoverTrigger asChild>
            <Button
                variant={variant}
                size={iconOnly ? iconSize : size}
                aria-label={triggerAriaLabel ?? (iconOnly ? defaultLabel : undefined)}
                className={cn("gap-1.5 font-normal", triggerClassName)}
            >
                {icon}
                {iconOnly ? null : <span className="truncate">{text}</span>}
                {activeCount > 0 ? (
                    // Reads as part of the button, not as a separate control: the accent says
                    // "something is applied" and the number says how much, without a second
                    // clickable thing beside a control that already opens on click.
                    <span
                        aria-hidden
                        className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-medium leading-4 text-primary-foreground"
                    >
                        {activeCount}
                    </span>
                ) : null}
            </Button>
        </PopoverTrigger>
    )
}
