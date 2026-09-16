/**
 * One of the project's MCP connections, as the Add MCP server drawer lists it.
 *
 * Three states, and they differ in what the row lets you do rather than only in how it
 * looks. `added` is already on this agent, so it carries no action at all: the way to
 * change that server is the rail row, not a second route from here. `connected` offers
 * Add. `expired` offers Reconnect and replaces the host line, because a host that cannot
 * be signed into is not the fact the reader needs.
 *
 * Presentational: no atom, no query, no dialog. The drawer owns every write, and the
 * dialogs the actions lead to are mounted outside the rows, which is the standing rule on
 * this surface — React events propagate through the React tree, so a dialog mounted inside
 * a row sends every click inside it back to the row.
 */
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Button, IconTile} from "@agenta/ui/ui"
import {ArrowClockwise, Check, Plugs, Plus} from "@phosphor-icons/react"

export type ConnectionRowState = "added" | "connected" | "expired"

export interface ConnectionListRowProps {
    name: string
    /** The server's hostname. Replaced by the expiry line when the login is expired. */
    host: string
    state: ConnectionRowState
    /**
     * Tools on the server, when the connection record carries a cached count. There is no
     * control-plane route for a count today, so this is normally absent and the row shows
     * the host alone rather than paying a handshake per row to fill it in.
     */
    toolCount?: number
    /** A write is in flight, so neither action may start a second one. */
    busy?: boolean
    onAdd?: () => void
    onReconnect?: () => void
}

export function ConnectionListRow({
    name,
    host,
    state,
    toolCount,
    busy,
    onAdd,
    onReconnect,
}: ConnectionListRowProps) {
    const expired = state === "expired"
    const subtitle = expired
        ? "Login expired"
        : toolCount == null
          ? host
          : `${host} · ${toolCount} ${toolCount === 1 ? "tool" : "tools"}`

    return (
        <div
            data-state={state}
            className={
                "flex items-center gap-3 rounded-lg border border-solid border-colorBorderSecondary px-3.5 py-3 " +
                (state === "added" ? "opacity-70" : "")
            }
        >
            <IconTile size={28}>
                <Plugs size={16} />
            </IconTile>

            <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-colorText">{name}</div>
                <div
                    className={
                        "truncate font-mono text-xs " +
                        (expired ? "text-colorWarning" : "text-colorTextTertiary")
                    }
                >
                    {subtitle}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
                {state === "added" ? (
                    <span className="flex items-center gap-1.5 text-xs text-colorTextSecondary">
                        <Check size={13} />
                        Added
                    </span>
                ) : null}

                {state === "connected" ? (
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
                ) : null}

                {expired ? (
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
                ) : null}
            </div>
        </div>
    )
}
