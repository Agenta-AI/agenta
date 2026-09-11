import type {ReactNode} from "react"

/**
 * The declarative shape behind {@link FilterMenu} and {@link GroupMenu}.
 *
 * Deliberately antd-free and entity-free: every icon is a `ReactNode` the consumer supplies, so
 * the menu never reaches for an icon set on its host's behalf and `web/mobile` (no antd,
 * lint-enforced) and the desktop app can mount the same component.
 */

/** Which block of the panel a row sits in. Sort and group render first, filters under them. */
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
    /** Absent on an option row; the discriminant that tells it from a toggle. */
    kind?: "options"
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
    /** Defaults to `"filter"`. Sort and group rows pass `"sort"` and render first. */
    block?: FilterMenuBlock
    /** What the flyout says when `options` is empty. */
    emptyText?: string
}

/**
 * A yes/no row: icon, label, and a switch on the right. No flyout — the row IS the control.
 *
 * For the facet that is not a choice among sets but a lens over one — "only archived" — where an
 * option list would offer two entries to say one bit. Toggles always render last in the panel.
 */
export interface FilterMenuToggle {
    kind: "toggle"
    /** Stable identity for the row — also the React key. */
    key: string
    label: string
    icon?: ReactNode
    checked: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
}

/** What the panel takes: an option row or a toggle row, in display order. */
export type FilterMenuItem<Value extends string = string> =
    | FilterMenuSection<Value>
    | FilterMenuToggle

export const isFilterMenuToggle = (item: FilterMenuItem): item is FilterMenuToggle =>
    "kind" in item && item.kind === "toggle"

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
     * The surface is not showing what it shows by default — a dot appears in the trigger's
     * corner.
     *
     * A narrowed table whose control looks untouched is the failure mode this exists for: the
     * rows are missing and nothing on screen says why.
     */
    active?: boolean
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
