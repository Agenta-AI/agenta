/**
 * One of the project's MCP connections, as the Add MCP server drawer lists it.
 *
 * Three row treatments, and they differ in what the row lets you do rather than only in how
 * it looks. An added connection is already on this agent, so it carries no action at all:
 * the way to change that server is its rail row, not a second route from here. A working one
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
import {cn} from "@agenta/ui/styles"
import {Button} from "@agenta/ui/ui"
import {Check, Plus} from "@phosphor-icons/react"

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

    return (
        <div
            data-state={added ? "added" : status}
            onClick={rowAction}
            className={cn(
                // Borderless; the -mx/px pair keeps the icon on the search field's edge while
                // the hover fill reaches past it.
                "-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors",
                rowAction && "cursor-pointer hover:bg-accent/60",
            )}
        >
            <McpServerMark size={24} name={name} />

            <div className="min-w-0 flex-1">
                <div className="truncate text-label font-medium leading-5 text-foreground">
                    {name}
                </div>
                <div className="truncate text-meta text-muted-foreground">{subtitle}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
                {added ? (
                    <span className="flex items-center gap-1 text-meta text-muted-foreground">
                        <Check size={14} />
                        {t("entityUi.mcpConnect.added")}
                    </span>
                ) : working ? (
                    <Button
                        variant="ghost"
                        size="icon-compact"
                        disabled={busy}
                        onClick={(event) => {
                            event.stopPropagation()
                            onAdd?.()
                        }}
                        aria-label={t("entityUi.mcpConnect.addNameToAgent", {name})}
                        title={t("entityUi.mcpConnect.addToAgent")}
                    >
                        <Plus className="size-3.5" />
                    </Button>
                ) : (
                    <Button
                        variant="outline"
                        size="compact"
                        disabled={busy}
                        onClick={(event) => {
                            event.stopPropagation()
                            onReconnect?.()
                        }}
                        aria-label={t("entityUi.mcpConnect.reconnectName", {name})}
                    >
                        {t("entityUi.mcpConnect.reconnect")}
                    </Button>
                )}
            </div>
        </div>
    )
}
