/**
 * One of the project's MCP connections, as the Add MCP server drawer lists it.
 *
 * Three row treatments, and they differ in what the row lets you do rather than only in how
 * it looks. An added connection is already on this agent: its menu can take it off. A working one
 * offers Add. One whose login has expired offers Reconnect and states that after the host.
 *
 * The status vocabulary is the data layer's `McpConnectionStatus`, not a set of words of this
 * component's own, so a row here and a row in the settings table cannot end up calling the
 * same connection two different things.
 *
 * Presentational: no atom, no query, no dialog. The drawer owns every write, and the dialogs
 * the actions lead to are mounted outside the rows, which is the standing rule on this
 * surface — React events propagate through the React tree, so a dialog mounted inside a row
 * sends every click inside it back to the row.
 */
import {getMcpConnectionStatusLabel, type McpConnectionStatus} from "@agenta/entities/mcpEndpoint"
import {useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {McpServerMark} from "@agenta/ui/agent-icon"
import {SimpleTooltip} from "@agenta/ui/composed"
import {Button} from "@agenta/ui/ui"
import {Check, Plus} from "@phosphor-icons/react"

import {CatalogListRow} from "../../DrillInView/SchemaControls/agentTemplate/CatalogListRow"
import {ConnectionRowMenu} from "../../DrillInView/SchemaControls/agentTemplate/ConnectionRowMenu"

export interface ConnectionListRowProps {
    name: string
    /** The server's hostname. A connection that is not working adds its status after it. */
    host: string
    status: McpConnectionStatus
    /** Already on the agent being edited. */
    added?: boolean
    /**
     * Tools on the server, when the connection record carries a cached count. There is no
     * control-plane route for a count today, so this is normally null and the row shows the
     * host alone rather than paying a handshake per row to fill it in.
     */
    toolCount?: number | null
    /** A write is in flight, so neither action may start a second one. */
    busy?: boolean
    onAdd?: () => void
    onReconnect?: () => void
    /** The connected row's menu: re-read the servers, and delete (the host asks first). */
    onRefresh?: () => void
    /** An added row's menu: take the server off the agent (the host asks first). */
    onRemoveFromAgent?: () => void
    onDelete?: () => void
}

export function ConnectionListRow({
    name,
    host,
    status,
    added,
    toolCount,
    busy,
    onAdd,
    onReconnect,
    onRefresh,
    onRemoveFromAgent,
    onDelete,
}: ConnectionListRowProps) {
    const t = useT(mcpConnectCatalog)
    const working = status === "connected"
    // A broken connection keeps its host and adds the state: "billing.acme.io · Not signed in".
    const subtitle = !working
        ? [host, getMcpConnectionStatusLabel(status)].filter(Boolean).join(" · ")
        : toolCount == null
          ? host
          : t("entityUi.mcpConnect.hostToolCount", {host, count: toolCount})
    // The whole row runs its one action; the button stays the keyboard path to it.
    const rowAction = added || busy ? undefined : working ? onAdd : onReconnect

    // The integration catalog's row: the 32 px Mark, title, meta line and action (CONS-02).
    return (
        <CatalogListRow
            variant="canvas"
            onClick={rowAction}
            actionLabel={
                working
                    ? t("entityUi.mcpConnect.addNameToAgent", {name})
                    : t("entityUi.mcpConnect.reconnectName", {name})
            }
            leading={<McpServerMark size={32} name={name} />}
            title={name}
            action={
                <span className="flex items-center gap-1">
                    {added ? (
                        <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
                            <Check size={14} />
                            {t("entityUi.mcpConnect.added")}
                        </span>
                    ) : working ? (
                        <SimpleTooltip title={t("entityUi.mcpConnect.addToAgent")}>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={busy}
                                // Shown on row hover and focus, always on touch, as in the catalog.
                                className="text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:opacity-0"
                                onClick={onAdd}
                                aria-label={t("entityUi.mcpConnect.addNameToAgent", {name})}
                            >
                                <Plus />
                            </Button>
                        </SimpleTooltip>
                    ) : (
                        <Button
                            variant="outline"
                            size="compact"
                            disabled={busy}
                            // `secondary` stacks on the row's hover fill (SURF-06).
                            className="hover:bg-secondary"
                            onClick={onReconnect}
                            aria-label={t("entityUi.mcpConnect.reconnectName", {name})}
                        >
                            {t("entityUi.mcpConnect.reconnect")}
                        </Button>
                    )}
                    {working && onRefresh ? (
                        <ConnectionRowMenu
                            onRefresh={onRefresh}
                            onRemoveFromAgent={added ? onRemoveFromAgent : undefined}
                            onDelete={onDelete}
                        />
                    ) : null}
                </span>
            }
        >
            <span className="truncate text-meta text-muted-foreground" title={subtitle}>
                {subtitle}
            </span>
        </CatalogListRow>
    )
}
