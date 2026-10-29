import {useMemo} from "react"

import {LayoutGrid, List} from "lucide-react"

import {Segmented, type SegmentedOption} from "../components/ui/segmented"
import {cn} from "../components/ui/utils"

import type {ListTableView} from "./types"

/**
 * The switch between a {@link ListTable}'s two views. Icon-only: the rows beside it are already
 * the subject, and "List" / "Cards" in words would be a second label in a toolbar that has one.
 *
 * At the toolbar's 32px — the same rung as the filter trigger it sits beside.
 */
export const ListTableViewToggle = ({
    value,
    onChange,
    className,
}: {
    value: ListTableView
    onChange: (next: ListTableView) => void
    className?: string
}) => {
    const options = useMemo<SegmentedOption[]>(
        () => [
            {value: "list", icon: <List size={14} aria-hidden />, "aria-label": "List"},
            {value: "grid", icon: <LayoutGrid size={14} aria-hidden />, "aria-label": "Cards"},
        ],
        [],
    )
    return (
        <Segmented
            aria-label="View"
            options={options}
            value={value}
            onChange={(next) => onChange(next as ListTableView)}
            className={cn("shrink-0", className)}
        />
    )
}
