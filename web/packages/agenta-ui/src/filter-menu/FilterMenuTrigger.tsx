import type {ReactNode} from "react"

import {Button} from "../components/ui/button"
import {PopoverTrigger} from "../components/ui/popover"
import {cn} from "../components/ui/utils"

import type {FilterMenuTriggerProps} from "./types"

/**
 * The button both menus open from.
 *
 * `label={null}` collapses it to the glyph alone — the shape a dense toolbar wants — which is why
 * the size flips to the icon variant rather than leaving an empty text box behind. The active dot
 * still rides along there: an icon-only trigger has even less room to say a view is narrowed.
 */
export const FilterMenuTrigger = ({
    label,
    icon,
    size = "sm",
    variant = "outline",
    triggerClassName,
    triggerAriaLabel,
    active = false,
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
                className={cn("relative gap-1.5 font-normal", triggerClassName)}
            >
                {icon}
                {iconOnly ? null : <span className="truncate">{text}</span>}
                {active ? (
                    <>
                        {/* A dot in the corner, not a count: the number was a second thing to
                            read on a control whose only job here is to say "this list is not
                            showing everything". What is applied is one click away. */}
                        <span
                            aria-hidden
                            className="absolute right-1 top-1 size-1.5 rounded-full bg-primary"
                        />
                        <span className="sr-only">(filters applied)</span>
                    </>
                ) : null}
            </Button>
        </PopoverTrigger>
    )
}
