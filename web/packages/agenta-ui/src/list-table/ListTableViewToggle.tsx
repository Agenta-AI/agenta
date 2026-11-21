import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {LayoutGrid, List} from "lucide-react"

import {Segmented, type SegmentedOption} from "../components/ui/segmented"
import {PHONE_TOUCH_TARGET_CLASS} from "../components/ui/touch-target"
import {cn} from "../components/ui/utils"

import type {ListTableView} from "./types"

/**
 * The switch between a {@link ListTable}'s two views. Icon-only: the rows beside it are already
 * the subject, and "List" / "Cards" in words would be a second label in a toolbar that has one.
 *
 * On the canvas scale (A03): one 28px track with two 24px options.
 */
/** On a phone each option is 44 px wide in a 44 px track, with a 44 px tap area (tap rule). */
const PHONE_OPTION = `max-md:min-w-11 max-md:self-stretch ${PHONE_TOUCH_TARGET_CLASS}`

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
                icon: <List size={14} aria-hidden />,
                "aria-label": "List",
                className: PHONE_OPTION,
            },
            {
                value: "grid",
                icon: <LayoutGrid size={14} aria-hidden />,
                "aria-label": "Cards",
                className: PHONE_OPTION,
            },
        ],
        [],
    )
    return (
        <Segmented
            aria-label={t("common.view")}
            size="compact"
            options={options}
            value={value}
            onChange={(next) => onChange(next as ListTableView)}
            className={cn("shrink-0 max-md:h-11", className)}
        />
    )
}
