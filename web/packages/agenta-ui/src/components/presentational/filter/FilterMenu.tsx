import type {ReactElement, ReactNode} from "react"

import {Check} from "lucide-react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "../../ui/dropdown-menu"

/** The floor the menu is laid out against. */
export const FILTER_MENU_MIN_WIDTH = 212

/**
 * How much room an anchor needs before it can end-align this menu.
 *
 * Deliberately WIDER than the min-width: a facet row carrying a long value ("Last 7 days") pushes
 * the menu past its floor — the sessions menu measures ~245px open — so an anchor that budgets
 * only the minimum still ends up cropped.
 */
export const FILTER_MENU_FLIP_WIDTH = 250

export interface FilterMenuOption {
    value: string
    label: string
}

/** A dimension with its own submenu of options — single-choice, or `multiple` for a set. */
export interface FilterMenuFacet {
    key: string
    label: string
    /** Single-choice: the chosen option. Ignored when `multiple`. */
    value?: string
    /** Multi-choice: the chosen options. Empty renders `emptyLabel` and counts as default. */
    values?: string[]
    multiple?: boolean
    options: FilterMenuOption[]
    /** The neutral value. Anything else renders emphasised, so an open menu shows what is on. */
    defaultValue?: string
    /** Multi-choice only: what the summary reads with nothing selected, e.g. "All agents". */
    emptyLabel?: string
    /** Multi-choice only: the summary past one selection, e.g. `(n) => `${n} agents``. */
    manyLabel?: (count: number) => string
    /** Multi-choice only: the option value that stands for "none selected". It renders checked
     * while the set is empty, and picking it clears the set — a way back to "all" from the menu. */
    noneValue?: string
    /** The options are still resolving. Renders a disabled placeholder row instead of an empty
     * submenu, so a facet whose catalog loads lazily never reads as "there are none". */
    loading?: boolean
    /** What the placeholder row reads while `loading`. */
    loadingLabel?: string
    icon?: ReactNode
}

/** An on/off dimension, rendered inline as a checkable row. */
export interface FilterMenuToggle {
    key: string
    label: string
    on: boolean
    icon?: ReactNode
}

export interface FilterMenuProps {
    facets?: FilterMenuFacet[]
    toggles?: FilterMenuToggle[]
    onFacetChange?: (key: string, value: string) => void
    /** Multi-choice facets report a toggle instead; the host owns the resulting set. */
    onFacetToggle?: (key: string, value: string, on: boolean) => void
    onToggleChange?: (key: string, on: boolean) => void
    onReset?: () => void
    resetLabel?: string
    resetIcon?: ReactNode
    /** Renders the reset row disabled when nothing is off-default. */
    dirty?: boolean
    side?: "top" | "right" | "bottom" | "left"
    align?: "start" | "center" | "end"
    /** Pass false to hold the chosen side/align even when the menu is wider than the space
     * beside it — for a menu anchored in a narrow rail, flipping is worse than overhanging. */
    avoidCollisions?: boolean
    /** Nudge along the align axis, in px. */
    alignOffset?: number
    /** Fires when the menu opens or closes. Lets a host defer work — a facet's catalog, say —
     * until the menu is actually on screen. */
    onOpenChange?: (open: boolean) => void
    /** The trigger; it becomes the menu's anchor, so it must forward a ref (`asChild`). */
    children: ReactElement
}

/**
 * A filter menu: single-choice facets as submenus, on/off dimensions as checkable rows, and a
 * reset. Entity-agnostic on purpose — it knows facets and toggles, never what is being filtered,
 * so any surface can drive it from its own state.
 */
export const FilterMenu = ({
    facets,
    toggles,
    onFacetChange,
    onFacetToggle,
    onToggleChange,
    onReset,
    resetLabel = "Reset to defaults",
    resetIcon,
    dirty = false,
    side = "bottom",
    align = "end",
    avoidCollisions = true,
    alignOffset = 0,
    onOpenChange,
    children,
}: FilterMenuProps) => {
    const hasFacets = Boolean(facets?.length)
    const hasToggles = Boolean(toggles?.length)

    return (
        <DropdownMenu onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
            <DropdownMenuContent
                side={side}
                align={align}
                alignOffset={alignOffset}
                avoidCollisions={avoidCollisions}
                style={{minWidth: FILTER_MENU_MIN_WIDTH}}
            >
                {facets?.map((facet) => {
                    const selected = facet.multiple ? (facet.values ?? []) : []
                    const isOn = (value: string) =>
                        facet.multiple
                            ? value === facet.noneValue
                                ? selected.length === 0
                                : selected.includes(value)
                            : value === facet.value
                    // Multi: nothing selected IS the default, so the summary reads as neutral.
                    const offDefault = facet.multiple
                        ? selected.length > 0
                        : facet.defaultValue !== undefined && facet.value !== facet.defaultValue
                    const summary = facet.multiple
                        ? selected.length === 0
                            ? (facet.emptyLabel ?? "All")
                            : selected.length === 1
                              ? (facet.options.find((option) => option.value === selected[0])
                                    ?.label ?? selected[0])
                              : (facet.manyLabel?.(selected.length) ??
                                `${selected.length} selected`)
                        : (facet.options.find((option) => option.value === facet.value)?.label ??
                          facet.value)

                    return (
                        <DropdownMenuSub key={facet.key}>
                            <DropdownMenuSubTrigger>
                                {facet.icon ? (
                                    <span className="flex shrink-0 items-center">{facet.icon}</span>
                                ) : null}
                                <span className="flex-1 truncate">{facet.label}</span>
                                <span
                                    className={
                                        offDefault
                                            ? "ml-2 max-w-[92px] truncate text-colorText"
                                            : "ml-2 max-w-[92px] truncate text-colorTextTertiary"
                                    }
                                >
                                    {summary}
                                </span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="max-h-[280px] min-w-[176px] max-w-[248px] overflow-y-auto">
                                {facet.options.map((option) => (
                                    <DropdownMenuItem
                                        key={option.value}
                                        // Multi-choice stays open: picking a set one item per
                                        // reopen is the whole cost of the feature.
                                        onSelect={(event) => {
                                            if (!facet.multiple) {
                                                onFacetChange?.(facet.key, option.value)
                                                return
                                            }
                                            event.preventDefault()
                                            const on =
                                                option.value === facet.noneValue
                                                    ? selected.length === 0
                                                    : !selected.includes(option.value)
                                            onFacetToggle?.(facet.key, option.value, on)
                                        }}
                                    >
                                        <span
                                            className="min-w-0 flex-1 truncate"
                                            title={option.label}
                                        >
                                            {option.label}
                                        </span>
                                        {isOn(option.value) ? (
                                            <Check className="ml-2 size-3.5 shrink-0" />
                                        ) : null}
                                    </DropdownMenuItem>
                                ))}
                                {facet.loading ? (
                                    <DropdownMenuItem disabled>
                                        <span className="min-w-0 flex-1 truncate text-colorTextTertiary">
                                            {facet.loadingLabel ?? "Loading…"}
                                        </span>
                                    </DropdownMenuItem>
                                ) : null}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    )
                })}

                {hasFacets && hasToggles ? <DropdownMenuSeparator /> : null}

                {toggles?.map((toggle) => (
                    <DropdownMenuItem
                        key={toggle.key}
                        // Keep the menu open: filters are usually set two or three at a time.
                        onSelect={(event) => {
                            event.preventDefault()
                            onToggleChange?.(toggle.key, !toggle.on)
                        }}
                    >
                        {toggle.icon ? (
                            <span className="flex shrink-0 items-center">{toggle.icon}</span>
                        ) : null}
                        <span className="flex-1 truncate">{toggle.label}</span>
                        {toggle.on ? <Check className="ml-2 size-3.5 shrink-0" /> : null}
                    </DropdownMenuItem>
                ))}

                {onReset ? (
                    <>
                        {hasFacets || hasToggles ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem disabled={!dirty} onSelect={() => onReset()}>
                            {resetIcon ? (
                                <span className="flex shrink-0 items-center">{resetIcon}</span>
                            ) : null}
                            {resetLabel}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
