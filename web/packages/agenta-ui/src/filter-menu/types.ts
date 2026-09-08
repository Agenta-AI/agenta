import type {ReactNode} from "react"

/**
 * The declarative shape behind {@link FilterMenu} and {@link GroupMenu}.
 *
 * Deliberately antd-free and entity-free: every icon is a `ReactNode` the consumer supplies, so
 * the menu never reaches for an icon set on its host's behalf and `web/mobile` (no antd,
 * lint-enforced) and the desktop app can mount the same component.
 */

/** Which block of the panel a row sits in. Sort and group live below the divider. */
export type FilterMenuBlock = "filter" | "sort"

/** Where a panel or a flyout opens, passed straight through to Radix. */
export type FilterMenuSide = "top" | "right" | "bottom" | "left"
export type FilterMenuAlign = "start" | "center" | "end"

export interface FilterMenuOption<Value extends string = string> {
    value: Value
    label: string
    /** Rendered at the option's left edge. Consumers own the icon set. */
    icon?: ReactNode
    disabled?: boolean
}

export interface FilterMenuSection<Value extends string = string> {
    /** Stable identity for the row — also the React key. */
    key: string
    label: string
    icon?: ReactNode
    /** A string for a single-select row, an array when `multi`. */
    value: Value | Value[]
    /** The muted summary on the row's right. Falls back to the selected option labels. */
    valueLabel?: string
    options: FilterMenuOption<Value>[]
    /** Fired with the option the reader picked; a `multi` row fires per option toggled. */
    onChange: (value: Value) => void
    /** Multi-select: options toggle and the check marks accumulate. */
    multi?: boolean
    /** Defaults to `"filter"`. Sort and group rows pass `"sort"`. */
    block?: FilterMenuBlock
    /** What the flyout says when `options` is empty. */
    emptyText?: string
}

export interface FilterMenuTriggerProps {
    /**
     * The trigger's word. `null` renders the icon alone — pass `triggerAriaLabel` with it so the
     * control still has a name.
     */
    label?: ReactNode | null
    /** Replaces the default leading glyph. */
    icon?: ReactNode
    size?: "sm" | "default" | "lg" | "icon" | "icon-sm"
    variant?: "outline" | "ghost" | "default" | "secondary" | "dashed" | "link"
    triggerClassName?: string
    triggerAriaLabel?: string
    /**
     * How many of the surface's controls are off their default, shown as a count on the trigger.
     *
     * A narrowed table whose control looks untouched is the failure mode this exists for: the
     * rows are missing and nothing on screen says why. `0` and absent both render the plain
     * button — the badge appears only when it has something to report.
     */
    activeCount?: number
}

export interface FilterMenuPlacementProps {
    /** Where the panel opens relative to its trigger. */
    side?: FilterMenuSide
    align?: FilterMenuAlign
    sideOffset?: number
    /** Where a row's flyout opens relative to the row. Defaults to `"right"` / `"start"`. */
    flyoutSide?: FilterMenuSide
    flyoutAlign?: FilterMenuAlign
    flyoutSideOffset?: number
}
