import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {MagnifyingGlassIcon, XIcon} from "@phosphor-icons/react"

import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput} from "../ui/input-group"
import {cn} from "../ui/utils"

/**
 * A page's toolbar: search, then filters, then the end slot (a view switch) at the far edge.
 * Not tied to any body: it sits over a list, a card grid, a form or anything else.
 *
 * Every part is optional, and the row draws nothing when no part is set (LAYOUT-07).
 * `actions` is a slot: this row does not know what narrows the list, only that something does.
 */
export const PageToolbar = ({
    search = "",
    onSearchChange,
    searchPlaceholder = "Search",
    searchAriaLabel,
    actions,
    end,
    className,
}: {
    search?: string
    /** Absent ⇒ no search field. */
    onSearchChange?: (next: string) => void
    searchPlaceholder?: string
    searchAriaLabel?: string
    /** Filters, sort, group: drawn after the search field. */
    actions?: ReactNode
    /** Drawn at the far edge: the view switch. */
    end?: ReactNode
    className?: string
}) => {
    const t = useT(commonCatalog)
    if (!onSearchChange && !actions && !end) return null
    return (
        // Wraps on a narrow screen, so the actions never squeeze the search to nothing.
        <div className={cn("mb-3 flex flex-wrap items-center gap-2", className)}>
            {/* 46 px high on a phone, so the field inside its 1 px border is 44 px (tap rule); the
                desktop keeps the control height. */}
            {onSearchChange ? (
                <InputGroup className="min-w-[160px] max-w-[340px] flex-1 bg-transparent dark:bg-transparent">
                    <InputGroupAddon>
                        <MagnifyingGlassIcon size={14} aria-hidden />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={search}
                        onChange={(event) => onSearchChange?.(event.target.value)}
                        placeholder={searchPlaceholder}
                        aria-label={searchAriaLabel ?? searchPlaceholder}
                        // Fills the group on a phone, so a tap anywhere in it lands on the field.
                        className="text-body"
                    />
                    {search ? (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton
                                size="icon-xs"
                                aria-label={t("common.clearSearch")}
                                onClick={() => onSearchChange?.("")}
                            >
                                <XIcon size={14} aria-hidden />
                            </InputGroupButton>
                        </InputGroupAddon>
                    ) : null}
                </InputGroup>
            ) : null}
            {actions}
            {end ? <div className="ml-auto flex items-center gap-2">{end}</div> : null}
        </div>
    )
}
