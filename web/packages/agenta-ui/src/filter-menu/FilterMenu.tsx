import {useState} from "react"

import {ListFilter} from "lucide-react"

import {Popover, PopoverContent} from "../components/ui/popover"

import {FilterMenuPanel} from "./FilterMenuPanel"
import {FilterMenuTrigger} from "./FilterMenuTrigger"
import type {FilterMenuPlacementProps, FilterMenuSection, FilterMenuTriggerProps} from "./types"

export interface FilterMenuProps extends FilterMenuTriggerProps, FilterMenuPlacementProps {
    /**
     * Every row the panel shows, in order. A section the consumer omits simply is not there —
     * dropping the group section is how a surface turns grouping off, and there is no
     * section-specific code path anywhere in here.
     */
    sections: FilterMenuSection[]
    /** The search field filters rows AND their options by label. Defaults on. */
    searchable?: boolean
    searchPlaceholder?: string
    /** Seeds the search field — a story or a restored view can land on a narrowed panel. */
    defaultSearch?: string
    /** Absent hides the footer's reset; the Esc hint stays either way. */
    onReset?: () => void
    resetLabel?: string
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
    activeCount,
}: FilterMenuProps) => {
    const [uncontrolled, setUncontrolled] = useState(false)
    const open = openProp ?? uncontrolled
    const setOpen = (next: boolean) => {
        setUncontrolled(next)
        onOpenChange?.(next)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <FilterMenuTrigger
                label={label}
                icon={icon ?? <ListFilter size={14} aria-hidden />}
                size={size}
                variant={variant}
                triggerClassName={triggerClassName}
                triggerAriaLabel={triggerAriaLabel}
                activeCount={activeCount}
                defaultLabel="Filter"
            />
            <PopoverContent
                side={side}
                align={align}
                sideOffset={sideOffset}
                aria-label="Filter, sort and group"
                className="p-0"
                onOpenAutoFocus={(event) => event.preventDefault()}
            >
                <FilterMenuPanel
                    sections={sections}
                    searchable={searchable}
                    searchPlaceholder={searchPlaceholder}
                    defaultSearch={defaultSearch}
                    onReset={onReset}
                    resetLabel={resetLabel}
                    flyoutSide={flyoutSide}
                    flyoutAlign={flyoutAlign}
                    flyoutSideOffset={flyoutSideOffset}
                    className={className}
                />
            </PopoverContent>
        </Popover>
    )
}
