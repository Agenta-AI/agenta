import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {ArchiveIcon, ArrowLeftIcon} from "@phosphor-icons/react"

import {cn} from "../components/ui/utils"

/** A quiet link under a list: "View archived", or "Back to active" while the archive shows. */
export const ListTableArchiveLink = ({
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
        <button
            type="button"
            onClick={() => onChange(!archived)}
            className={cn(
                "mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent p-0 font-[inherit] text-label text-muted-foreground hover:text-foreground focus-ring",
                className,
            )}
        >
            {archived ? (
                <ArrowLeftIcon size={14} aria-hidden />
            ) : (
                <ArchiveIcon size={14} aria-hidden />
            )}
            {archived ? t("common.backToActive") : t("common.viewArchived")}
        </button>
    )
}
