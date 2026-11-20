import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Search, X} from "lucide-react"

import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from "../components/ui/input-group"
import {cn} from "../components/ui/utils"

/**
 * The row above a {@link ListTable}: a search field, then whatever narrows the list.
 *
 * The field is part of the page rather than a raised control on it, so it drops the input
 * group's own tinted fill, and it sits at the toolbar's 32px rather than a form field's 36 —
 * next to a filter button, a taller field reads as the odd one out.
 *
 * `actions` is a slot, not a filter prop: this row does not know what narrows the list, only
 * that something does. A filter menu, a segmented control, a "New" button all belong there.
 */
export const ListTableToolbar = ({
    search,
    onSearchChange,
    searchPlaceholder = "Search",
    searchAriaLabel,
    actions,
    className,
}: {
    search: string
    onSearchChange: (next: string) => void
    searchPlaceholder?: string
    searchAriaLabel?: string
    actions?: ReactNode
    className?: string
}) => {
    const t = useT(commonCatalog)
    return (
        <div className={cn("mb-3 flex items-center gap-2", className)}>
            {/* 46 px high on a phone, so the field inside its 1 px border is 44 px (tap rule); the
                desktop keeps the control height. */}
            <InputGroup className="min-w-0 max-w-[340px] flex-1 bg-transparent max-md:h-[46px] dark:bg-transparent">
                <InputGroupAddon>
                    <Search size={14} aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder={searchPlaceholder}
                    aria-label={searchAriaLabel ?? searchPlaceholder}
                    // Fills the group on a phone, so a tap anywhere in it lands on the field.
                    className="text-[13px] max-md:h-full md:text-[13px]"
                />
                {search ? (
                    <InputGroupAddon align="inline-end">
                        <InputGroupButton
                            size="icon-xs"
                            aria-label={t("common.clearSearch")}
                            onClick={() => onSearchChange("")}
                        >
                            <X size={14} aria-hidden />
                        </InputGroupButton>
                    </InputGroupAddon>
                ) : null}
            </InputGroup>
            {actions}
        </div>
    )
}
