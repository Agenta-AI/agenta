import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {ArchiveIcon} from "@phosphor-icons/react"

import {Button} from "../components/ui/button"
import {cn} from "../components/ui/utils"

/** Archived on or off: a pressed button beside Filter, the same size and style. */
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
    return (
        <Button
            variant="outline"
            aria-pressed={archived}
            onClick={() => onChange(!archived)}
            className={cn(
                "shrink-0 gap-1.5",
                archived && "bg-selected hover:bg-selected",
                className,
            )}
        >
            <ArchiveIcon size={14} aria-hidden />
            {t("common.archived")}
        </Button>
    )
}
