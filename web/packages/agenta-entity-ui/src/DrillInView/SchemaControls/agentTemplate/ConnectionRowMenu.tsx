/** A connection row's kebab: the host's own verbs first, then Refresh, Revoke and Delete. */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {ArrowClockwise, DotsThreeVertical, Trash, XCircle} from "@phosphor-icons/react"

/** An item a host adds to the menu, such as Run or Make default. */
export interface ConnectionMenuItem {
    key: string
    label: string
    icon: ReactNode
    onSelect: () => void
}

export function ConnectionRowMenu({
    items = [],
    onRefresh,
    onRevoke,
    onDelete,
}: {
    items?: ConnectionMenuItem[]
    onRefresh: () => void
    /** Absent for someone who may not change the connection (read-only on the project). */
    onRevoke?: () => void
    onDelete?: () => void
}) {
    const t = useT(integrationDrawerCatalog)
    return (
        <DropdownMenu>
            <SimpleTooltip title={t("entityUi.integrationDrawer.connectionActions")}>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("entityUi.integrationDrawer.connectionActions")}
                        // Always shown and quiet, so nothing changes or shifts on hover.
                        className="text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        <DotsThreeVertical aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
            </SimpleTooltip>
            <DropdownMenuContent align="end" className="min-w-[160px]">
                {items.map((item) => (
                    <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
                        {item.icon}
                        {item.label}
                    </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={onRefresh}>
                    <ArrowClockwise size={14} />
                    {t("entityUi.integrationDrawer.refresh")}
                </DropdownMenuItem>
                {onRevoke ? (
                    <DropdownMenuItem onSelect={onRevoke}>
                        <XCircle size={14} />
                        {t("entityUi.integrationDrawer.revoke")}
                    </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={onDelete}>
                            <Trash size={14} />
                            {t("entityUi.integrationDrawer.delete")}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
