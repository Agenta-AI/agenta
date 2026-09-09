import type {ReactNode} from "react"

import {Search} from "lucide-react"

import {InputGroup, InputGroupAddon, InputGroupInput} from "../components/ui/input-group"
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
}) => (
    <div className={cn("mb-3 flex items-center gap-2", className)}>
        <InputGroup className="h-8 min-w-0 max-w-[340px] flex-1 bg-transparent dark:bg-transparent">
            <InputGroupAddon>
                <Search size={14} aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchAriaLabel ?? searchPlaceholder}
                className="text-[13px] md:text-[13px]"
            />
        </InputGroup>
        {actions}
    </div>
)
