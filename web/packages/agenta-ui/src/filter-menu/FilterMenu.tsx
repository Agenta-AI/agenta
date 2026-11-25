import {useState} from "react"

import {useT} from "@agenta/i18n"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import {SlidersHorizontalIcon} from "@phosphor-icons/react"

import {Popover, PopoverContent} from "../components/ui/popover"
import {useMediaQuery} from "../hooks/useMediaQuery"
import {BottomSheet} from "../phone/BottomSheet"

import {DRILLDOWN_QUERY, FilterMenuPanel} from "./FilterMenuPanel"
import {FilterMenuTrigger} from "./FilterMenuTrigger"
import {
    isFilterMenuNarrowed,
    type FilterMenuItem,
    type FilterMenuPlacementProps,
    type FilterMenuTriggerProps,
} from "./types"

export interface FilterMenuProps extends FilterMenuTriggerProps, FilterMenuPlacementProps {
    /**
     * Every row the panel shows, in order. A section the consumer omits simply is not there —
     * dropping the group section is how a surface turns grouping off, and there is no
     * section-specific code path anywhere in here.
     */
    sections: FilterMenuItem[]
    /** The search field filters rows AND their options by label. Defaults on. */
    searchable?: boolean
    searchPlaceholder?: string
    /** Seeds the search field — a story or a restored view can land on a narrowed panel. */
    defaultSearch?: string
    /** Absent hides the reset row entirely — there is nothing else in that footer. */
    onReset?: () => void
    resetLabel?: string
    /** The view is already at its defaults: the row stays, greyed, rather than disappearing. */
    resetDisabled?: boolean
    /** Controlled open state. Leave both off for an uncontrolled menu. */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    className?: string
}

/**
 * One popover that holds a surface's whole view configuration: filters above a divider, sort and
 * group below it, a search field over the lot and a reset beneath.
 *
 * Host-agnostic by construction — antd-free, entity-free, and every icon arrives as a
 * `ReactNode` prop — so `web/mobile` (which bans antd) and the desktop app mount the same
 * component over their own data.
 */
export const FilterMenu = ({
    sections,
    searchable,
    searchPlaceholder,
    defaultSearch,
    onReset,
    resetLabel,
    resetDisabled,
    open: openProp,
    onOpenChange,
    side = "bottom",
    align = "start",
    sideOffset = 6,
    flyoutSide,
    flyoutAlign,
    flyoutSideOffset,
    className,
    label,
    icon,
    size,
    variant,
    triggerClassName,
    triggerAriaLabel,
    active,
}: FilterMenuProps) => {
    const t = useT(uiControlsCatalog)
    const [uncontrolled, setUncontrolled] = useState(false)
    const open = openProp ?? uncontrolled
    const setOpen = (next: boolean) => {
        setUncontrolled(next)
        onOpenChange?.(next)
    }

    // A phone opens the panel as a bottom sheet (COMPACT-04): rows drill in, nothing hovers.
    const compact = useMediaQuery(DRILLDOWN_QUERY)
    // One row is a plain filter: name the panel after it, not "Filter, sort and group".
    const single = sections.length === 1 ? sections[0] : null
    const title = single ? single.label : t("ui.controls.filterSortGroup")
    const trigger = (
        <FilterMenuTrigger
            label={label}
            icon={icon ?? <SlidersHorizontalIcon size={14} aria-hidden />}
            size={size}
            variant={variant}
            triggerClassName={triggerClassName}
            triggerAriaLabel={triggerAriaLabel}
            active={Boolean(active) || isFilterMenuNarrowed(sections)}
            defaultLabel={t("ui.controls.filter")}
            onClick={compact ? () => setOpen(true) : undefined}
        />
    )
    const panel = (
        <FilterMenuPanel
            sections={sections}
            // A phone sheet holds a few rows: a search field there is one more thing to tap past.
            searchable={compact ? false : searchable}
            searchPlaceholder={
                searchPlaceholder ?? (single ? t("ui.controls.searchEllipsis") : undefined)
            }
            defaultSearch={defaultSearch}
            onReset={onReset}
            resetLabel={resetLabel}
            resetDisabled={resetDisabled}
            flyoutSide={flyoutSide}
            flyoutAlign={flyoutAlign}
            flyoutSideOffset={flyoutSideOffset}
            fluid={compact}
            className={className}
        />
    )

    if (compact) {
        return (
            <>
                {trigger}
                <BottomSheet
                    open={open}
                    onOpenChange={setOpen}
                    title={title}
                    // Each choice applies as it is tapped: swipe down or tap out to close.
                    hideClose
                    keepKeyboardClosed
                    data-testid="filter-menu-sheet"
                >
                    {panel}
                </BottomSheet>
            </>
        )
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            {trigger}
            <PopoverContent
                side={side}
                align={align}
                sideOffset={sideOffset}
                aria-label={title}
                className="p-0"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                {panel}
            </PopoverContent>
        </Popover>
    )
}
