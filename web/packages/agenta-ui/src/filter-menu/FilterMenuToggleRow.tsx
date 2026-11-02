import {Switch} from "../components/ui/switch"
import {cn} from "../components/ui/utils"

import type {FilterMenuToggle} from "./types"

/**
 * A toggle row: the same shape as an option row, with a switch where the value and chevron
 * would be. The whole row is the control — clicking the label flips it, so the switch itself
 * is decorative and stays out of the tab order. A `div`, not a `<button>`: the switch is one,
 * and a button inside a button is invalid HTML.
 */
export const FilterMenuToggleRow = ({
    item,
    rowRef,
    tabIndex,
    onMouseEnter,
    onKeyDown,
}: {
    item: FilterMenuToggle
    rowRef?: (node: HTMLDivElement | null) => void
    tabIndex?: number
    /** Pointer arrived on the row — the panel shuts any open flyout. */
    onMouseEnter?: () => void
    onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
}) => {
    const flip = () => {
        if (!item.disabled) item.onChange(!item.checked)
    }
    return (
        <div
            ref={rowRef}
            role="switch"
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            tabIndex={item.disabled ? -1 : tabIndex}
            onMouseEnter={onMouseEnter}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    flip()
                    return
                }
                onKeyDown?.(event)
            }}
            onClick={flip}
            className={cn(
                "box-border flex w-full select-none items-center gap-2 rounded-control-sm px-2 py-1.5 text-left",
                "text-[13px] text-foreground outline-none transition-colors",
                item.disabled
                    ? "cursor-not-allowed opacity-45"
                    : "cursor-pointer hover:bg-accent focus-visible:bg-accent",
            )}
        >
            {item.icon ? (
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                    {item.icon}
                </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <Switch
                size="sm"
                checked={item.checked}
                disabled={item.disabled}
                tabIndex={-1}
                aria-hidden
                className="pointer-events-none shrink-0"
            />
        </div>
    )
}
