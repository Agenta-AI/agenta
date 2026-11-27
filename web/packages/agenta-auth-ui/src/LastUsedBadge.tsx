import {useT} from "@agenta/i18n"
import authSharedCatalog from "@agenta/i18n/catalogs/auth.shared"
import {Badge, cn} from "@agenta/ui/ui"

/** Marks the method the visitor signed in with last time. */
export const LastUsedBadge = ({className}: {className?: string}) => {
    const t = useT(authSharedCatalog)
    return (
        <Badge
            variant="default"
            className={cn(
                "pointer-events-none rounded-md px-2 text-caption font-medium text-muted-foreground",
                className,
            )}
        >
            {t("auth.shared.lastUsed")}
        </Badge>
    )
}
