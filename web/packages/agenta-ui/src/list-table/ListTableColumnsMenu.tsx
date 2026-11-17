import {Columns3} from "lucide-react"

import {Button} from "../components/ui/button"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu"
import {cn} from "../components/ui/utils"

import type {ListTableColumn} from "./types"
import {isColumnHideable} from "./useListTableColumnVisibility"

/**
 * A "Columns" menu with a checkbox per column, for the toolbar's `actions` slot. Pair it with
 * {@link useListTableColumnVisibility}.
 *
 * Not drawn on a narrow list: below `minColumns` hideable columns there is little to choose, and
 * below the `md` width the trigger is hidden, because a phone list already drops its columns.
 * The last visible column cannot be hidden.
 */
export const ListTableColumnsMenu = ({
    columns,
    hiddenKeys,
    onChange,
    minColumns = 4,
    label = "Columns",
    className,
}: {
    /** Every column of the list, also the hidden ones. */
    columns: ListTableColumn[]
    hiddenKeys: ReadonlySet<string>
    onChange: (columnKey: string, visible: boolean) => void
    minColumns?: number
    label?: string
    className?: string
}) => {
    const hideable = columns.filter(isColumnHideable)
    if (hideable.length < minColumns) return null
    const visibleCount = hideable.filter((column) => !hiddenKeys.has(column.key)).length
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn("hidden md:inline-flex", className)}
                >
                    <Columns3 aria-hidden data-icon="inline-start" />
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {hideable.map((column) => {
                    const visible = !hiddenKeys.has(column.key)
                    return (
                        <DropdownMenuCheckboxItem
                            key={column.key}
                            checked={visible}
                            disabled={visible && visibleCount === 1}
                            // Keep the menu open, so several columns can be changed in one go.
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => onChange(column.key, checked === true)}
                        >
                            {column.label}
                        </DropdownMenuCheckboxItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
