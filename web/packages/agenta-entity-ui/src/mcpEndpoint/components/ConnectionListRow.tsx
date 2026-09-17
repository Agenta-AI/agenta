/**
 * One of the project's MCP connections, as the Add MCP server drawer lists it.
 *
 * Three row treatments, and they differ in what the row lets you do rather than only in how
 * it looks. An added connection is already on this agent, so it carries no action at all:
 * the way to change that server is its rail row, not a second route from here. A working one
 * offers Add. One whose login has expired offers Reconnect and states that in place of the
 * host, because a host you cannot sign in to is not the fact the reader needs.
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
import {formatCount} from "@agenta/shared/utils"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {Button, IconTile} from "@agenta/ui/ui"
import {ArrowClockwise, Check, Plugs, Plus} from "@phosphor-icons/react"

export interface ConnectionListRowProps {
    name: string
    /** The server's hostname. Replaced by the status when the connection is not working. */
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
    const working = status === "connected"
    const subtitle = !working
        ? getMcpConnectionStatusLabel(status)
        : toolCount == null
          ? host
          : `${host} · ${formatCount(toolCount, "tool")}`

    return (
        <div
            data-state={added ? "added" : status}
            className={cn(
                "flex items-center gap-3 rounded-lg border border-solid border-colorBorderSecondary px-3.5 py-3",
                added && "opacity-70",
            )}
        >
            <IconTile size={28}>
                <Plugs />
            </IconTile>

            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-colorText">{name}</div>
                <div
                    className={cn(
                        "truncate font-mono text-xs",
                        working ? "text-colorTextTertiary" : "text-colorWarning",
                    )}
                >
                    {subtitle}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
                {added ? (
                    <span className="flex items-center gap-1.5 text-xs text-colorTextSecondary">
                        <Check size={13} />
                        Added
                    </span>
                ) : working ? (
                    <>
                        {/* The spec draws a bare dot. The label stays for a screen reader,
                            which would otherwise hear an unexplained control. */}
                        <StatusIndicator
                            tone="success"
                            label={<span className="sr-only">Connected</span>}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={onAdd}
                            aria-label={`Add ${name} to this agent`}
                        >
                            <Plus size={12} />
                            Add
                        </Button>
                    </>
                ) : (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={onReconnect}
                        aria-label={`Reconnect ${name}`}
                    >
                        <ArrowClockwise size={12} />
                        Reconnect
                    </Button>
                )}
            </div>
        </div>
    )
}
