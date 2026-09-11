import {Switch} from "../components/ui/switch"
import {cn} from "../components/ui/utils"

import type {FilterMenuToggle} from "./types"

/**
 * A toggle row: the same shape as an option row, with a switch where the value and chevron
 * would be. The whole row is the control — clicking the label flips it, so the switch itself
 * is decorative and stays out of the tab order.
 */
export const FilterMenuToggleRow = ({
    item,
    rowRef,
    tabIndex,
    onMouseEnter,
    onKeyDown,
}: {
    item: FilterMenuToggle
    rowRef?: (node: HTMLButtonElement | null) => void
    tabIndex?: number
    /** Pointer arrived on the row — the panel shuts any open flyout. */
    onMouseEnter?: () => void
    onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}) => (
    <button
        ref={rowRef}
        type="button"
        role="switch"
        aria-checked={item.checked}
        disabled={item.disabled}
        tabIndex={tabIndex}
        onMouseEnter={onMouseEnter}
        onKeyDown={onKeyDown}
        onClick={() => item.onChange(!item.checked)}
        className={cn(
            // Preflight is off app-wide, so the <button> reset is restated here.
            "box-border cursor-pointer appearance-none border-0 bg-transparent font-[inherit]",
            "flex w-full items-center gap-2 rounded-control-sm px-2 py-1.5 text-left",
            "text-[13px] text-foreground outline-none transition-colors",
            "hover:bg-accent focus-visible:bg-accent",
            "disabled:cursor-not-allowed disabled:opacity-45",
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
    </button>
)
