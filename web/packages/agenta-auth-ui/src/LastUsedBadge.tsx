import {useT} from "@agenta/i18n"
import authSharedCatalog from "@agenta/i18n/catalogs/auth.shared"
import {Badge, cn} from "@agenta/ui/ui"

/** Marks the method the visitor signed in with last time. */
export const LastUsedBadge = ({className}: {className?: string}) => {
    const t = useT(authSharedCatalog)
    return (
        <Badge
            variant="outlined"
            className={cn(
                "pointer-events-none rounded-full px-2 text-[11px] font-medium leading-4 text-muted-foreground",
                className,
            )}
        >
            {t("auth.shared.lastUsed")}
        </Badge>
    )
}
