/** A connection row's kebab: the host's verbs, Refresh, Revoke, then the destructive ones (ACT-03). */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import integrationDrawerCatalog from "@agenta/i18n/catalogs/entityUi.integrationDrawer"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {SimpleTooltip} from "@agenta/ui/composed"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ArrowClockwise, DotsThreeVertical, MinusCircle, Trash, XCircle} from "@phosphor-icons/react"

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
    onRemoveFromAgent,
    onDelete,
}: {
    items?: ConnectionMenuItem[]
    onRefresh: () => void
    /** Absent for someone who may not change the connection (read-only on the project). */
    onRevoke?: () => void
    /** The connection is on the agent: takes it off the agent, after the host's question. */
    onRemoveFromAgent?: () => void
    /** Deletes the project's connection, after the host's question. */
    onDelete?: () => void
}) {
    const t = useT(integrationDrawerCatalog, integrationViewsCatalog)
    return (
        <DropdownMenu>
            <SimpleTooltip title={t("entityUi.integrationDrawer.connectionActions")}>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("entityUi.integrationDrawer.connectionActions")}
                        // Always shown; `secondary` stacks on the row's hover fill (SURF-06).
                        className="text-muted-foreground hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary"
                    >
                        <DotsThreeVertical aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
            </SimpleTooltip>
            <DropdownMenuContent align="end">
                {items.map((item) => (
                    <DropdownMenuItem key={item.key} onSelect={item.onSelect}>
                        {item.icon}
                        {item.label}
                    </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={onRefresh}>
                    <ArrowClockwise />
                    {t("entityUi.integrationDrawer.refresh")}
                </DropdownMenuItem>
                {onRevoke ? (
                    <DropdownMenuItem onSelect={onRevoke}>
                        <XCircle />
                        {t("entityUi.integrationDrawer.revoke")}
                    </DropdownMenuItem>
                ) : null}
                {onRemoveFromAgent || onDelete ? <DropdownMenuSeparator /> : null}
                {onRemoveFromAgent ? (
                    <DropdownMenuItem variant="destructive" onSelect={onRemoveFromAgent}>
                        <MinusCircle />
                        {t("entityUi.integrationViews.removeFromAgent")}
                    </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                        <Trash />
                        {t("entityUi.integrationDrawer.delete")}
                    </DropdownMenuItem>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
