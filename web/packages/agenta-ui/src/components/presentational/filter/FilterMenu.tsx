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

export interface FilterMenuOption {
    value: string
    label: string
}

/** A single-choice dimension: opens a submenu of its options. */
export interface FilterMenuFacet {
    key: string
    label: string
    value: string
    options: FilterMenuOption[]
    /** The neutral value. Anything else renders emphasised, so an open menu shows what is on. */
    defaultValue?: string
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
    onToggleChange,
    onReset,
    resetLabel = "Reset to defaults",
    resetIcon,
    dirty = false,
    side = "bottom",
    align = "end",
    avoidCollisions = true,
    alignOffset = 0,
    children,
}: FilterMenuProps) => {
    const hasFacets = Boolean(facets?.length)
    const hasToggles = Boolean(toggles?.length)

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
            <DropdownMenuContent
                side={side}
                align={align}
                alignOffset={alignOffset}
                avoidCollisions={avoidCollisions}
                className="min-w-[212px]"
            >
                {facets?.map((facet) => (
                    <DropdownMenuSub key={facet.key}>
                        <DropdownMenuSubTrigger>
                            {facet.icon ? (
                                <span className="flex shrink-0 items-center">{facet.icon}</span>
                            ) : null}
                            <span className="flex-1 truncate">{facet.label}</span>
                            <span
                                className={
                                    facet.defaultValue !== undefined &&
                                    facet.value !== facet.defaultValue
                                        ? "ml-2 max-w-[92px] truncate text-colorText"
                                        : "ml-2 max-w-[92px] truncate text-colorTextTertiary"
                                }
                            >
                                {facet.options.find((option) => option.value === facet.value)
                                    ?.label ?? facet.value}
                            </span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-[280px] min-w-[176px] overflow-y-auto">
                            {facet.options.map((option) => (
                                <DropdownMenuItem
                                    key={option.value}
                                    onSelect={() => onFacetChange?.(facet.key, option.value)}
                                >
                                    <span className="flex-1 truncate">{option.label}</span>
                                    {option.value === facet.value ? (
                                        <Check className="ml-2 size-3.5 shrink-0" />
                                    ) : null}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                ))}

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
