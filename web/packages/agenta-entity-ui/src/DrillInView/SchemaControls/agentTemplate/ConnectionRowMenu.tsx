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
    onRevoke: () => void
    onDelete: () => void
}) {
    const t = useT(integrationDrawerCatalog)
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("entityUi.integrationDrawer.connectionActions")}
                    // Shown on row hover where there is hover; always on touch. The row already
                    // hovers to accent, so the button's own hover is a foreground wash.
                    className="hover:bg-foreground/10 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100 dark:hover:bg-foreground/15 [@media(hover:hover)]:opacity-0"
                >
                    <DotsThreeVertical aria-hidden weight="bold" />
                </Button>
            </DropdownMenuTrigger>
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
                <DropdownMenuItem onSelect={onRevoke}>
                    <XCircle size={14} />
                    {t("entityUi.integrationDrawer.revoke")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash size={14} />
                    {t("entityUi.integrationDrawer.delete")}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
