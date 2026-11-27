import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {ListIcon, SquaresFourIcon} from "@phosphor-icons/react"

import {Segmented, type SegmentedOption} from "../components/composed/segmented"
import {cn} from "../components/ui/utils"

import type {ListTableView} from "./types"

/**
 * The switch between a {@link ListTable}'s two views. Icon-only: the rows beside it are already
 * the subject, and "List" / "Cards" in words would be a second label in a toolbar that has one.
 *
 * The control height (32px), the same as the search field and the Filter button beside it.
 */
/** On a phone each option is 44 px wide in a 44 px track, with a 44 px tap area (tap rule). */

export const ListTableViewToggle = ({
    value,
    onChange,
    className,
}: {
    value: ListTableView
    onChange: (next: ListTableView) => void
    className?: string
}) => {
    const t = useT(commonCatalog)
    const options = useMemo<SegmentedOption[]>(
        () => [
            {
                value: "list",
                icon: <ListIcon size={14} aria-hidden />,
                "aria-label": "List",
            },
            {
                value: "grid",
                icon: <SquaresFourIcon size={14} aria-hidden />,
                "aria-label": "Cards",
            },
        ],
        [],
    )
    return (
        <Segmented
            aria-label={t("common.view")}
            options={options}
            value={value}
            onChange={(next) => onChange(next as ListTableView)}
            // Hidden on a phone, where the list is the only view.
            className={cn("shrink-0 max-sm:hidden", className)}
        />
    )
}
