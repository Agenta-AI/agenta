import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"

import {Segmented, type SegmentedOption} from "../components/ui/segmented"
import {cn} from "../components/ui/utils"

/** Active or Archived: which set the list shows. Its own control, not a row in the filter menu. */
export const ListTableArchiveToggle = ({
    archived,
    onChange,
    className,
}: {
    archived: boolean
    onChange: (archived: boolean) => void
    className?: string
}) => {
    const t = useT(commonCatalog)
    const options: SegmentedOption[] = [
        {value: "active", label: t("common.active")},
        {value: "archived", label: t("common.archived")},
    ]
    return (
        <Segmented
            aria-label={t("common.activeOrArchived")}
            options={options}
            value={archived ? "archived" : "active"}
            onChange={(next) => onChange(next === "archived")}
            className={cn("shrink-0", className)}
        />
    )
}
