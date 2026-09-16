/**
 * Pick one of the project's MCP connections for this agent, or connect a new one.
 *
 * This replaces the connection picker that used to sit inside the agent's MCP form. The
 * difference is not cosmetic: a select asked the author to know which connection they
 * wanted before they could see what the project had, and it offered no route to a server
 * whose login had expired. A list answers both.
 *
 * Presentational, like {@link AddSubagentDrawer}: every connection arrives as a prop and
 * every write goes back out as a callback. The host reads `mcpEndpointsQueryAtom` and
 * mounts the connect journey, which is the standing rule for this surface — a dialog
 * mounted inside a clickable row sends every click inside it back to the row.
 */
import {useEffect, useMemo, useState} from "react"

import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, EmptyState, IconTile, SearchInput, SkeletonBlock} from "@agenta/ui/ui"
import {Info, Plugs, Plus} from "@phosphor-icons/react"

import {ConnectionListRow, type ConnectionRowState} from "./components/ConnectionListRow"

/** One connection in the project registry, as this drawer needs it. */
export interface McpConnectionOption {
    /** The slug the gateway resolves at run time, and this row's key. */
    slug: string
    name: string
    host: string
    /** Absent unless the connection record carries a cached count; see ConnectionListRow. */
    toolCount?: number
    /** Whether the login is usable. Servers that are simply down are not distinguishable. */
    state: "connected" | "expired"
    /** Already on the agent being edited. */
    added?: boolean
}

export interface McpAddServerDrawerProps {
    open: boolean
    onClose: () => void
    /** The project registry, sorted by name. Added rows keep their place. */
    options: McpConnectionOption[]
    loading?: boolean
    /** Opens the connect sheet. The one hero action, and the empty state's only action. */
    onConnectServer: () => void
    /** Adds the connection to the agent. May be async; actions are disabled until it settles. */
    onAdd: (option: McpConnectionOption) => void | Promise<void>
    /** Runs the auth step alone for an expired login. */
    onReconnect: (option: McpConnectionOption) => void
}

const FOOTER_NOTE =
    "Add opens the permission drawer for this agent. Connect server adds the new server once it's connected."

/** Uneven widths: three identical bars read as a graphic, not as rows about to arrive. */
const SKELETON_WIDTHS: [string, string][] = [
    ["w-28", "w-44"],
    ["w-20", "w-36"],
    ["w-32", "w-40"],
]

function RowSkeleton({widths}: {widths: [string, string]}) {
    return (
        <div
            data-testid="mcp-connection-skeleton"
            className="flex items-center gap-3 rounded-lg border border-solid border-colorBorderSecondary px-3.5 py-3"
        >
            <SkeletonBlock className="size-7 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <SkeletonBlock className={`h-3.5 ${widths[0]}`} />
                <SkeletonBlock className={`h-3 ${widths[1]}`} />
            </div>
            <SkeletonBlock className="h-7 w-16 shrink-0 rounded-md" />
        </div>
    )
}

const rowState = (option: McpConnectionOption): ConnectionRowState =>
    option.added ? "added" : option.state

export function McpAddServerDrawer({
    open,
    onClose,
    options,
    loading,
    onConnectServer,
    onAdd,
    onReconnect,
}: McpAddServerDrawerProps) {
    const [search, setSearch] = useState("")
    // One write in flight at a time: two overlapping adds both start from the same array.
    const [busy, setBusy] = useState(false)

    // Reset on the `open` transition: `destroyOnClose` unmounts the body, not this component.
    useEffect(() => {
        if (!open) setSearch("")
    }, [open])

    const query = search.trim().toLowerCase()
    const visible = useMemo(() => {
        if (!query) return options
        // Name and host, the two things the row shows. A row that survives the filter
        // therefore always contains the typed text somewhere a reader can see it.
        return options.filter(
            (option) =>
                option.name.toLowerCase().includes(query) ||
                option.host.toLowerCase().includes(query),
        )
    }, [options, query])

    const handleAdd = async (option: McpConnectionOption) => {
        if (busy) return
        setBusy(true)
        try {
            await onAdd(option)
        } finally {
            setBusy(false)
        }
    }

    const handleClose = () => {
        setSearch("")
        onClose()
    }

    // The empty project, which is a different screen from an empty search: it carries the
    // only call to action and the header button goes away, where a fruitless search keeps
    // the header button and says so inline.
    const emptyProject = !loading && options.length === 0

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={handleClose}
            placement="responsive"
            destroyOnClose
            title={<span className="text-sm font-semibold">Add MCP server</span>}
            extra={
                emptyProject ? undefined : (
                    <Button size="sm" onClick={onConnectServer}>
                        <Plus size={13} />
                        Connect server
                    </Button>
                )
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                emptyProject ? null : (
                    <div className="flex items-start gap-1.5 text-xs text-colorTextTertiary">
                        <Info size={13} className="mt-px shrink-0" />
                        <span>{FOOTER_NOTE}</span>
                    </div>
                )
            }
        >
            {emptyProject ? (
                <div className="flex flex-1 items-center justify-center p-6">
                    <EmptyState
                        className="max-w-[320px] text-center"
                        image={
                            <IconTile size={44} tone="muted">
                                <Plugs size={22} />
                            </IconTile>
                        }
                        title="No MCP servers in this project yet"
                        description="Connect an MCP server by URL. You'll sign in or add a key once, and every agent in the project can use it."
                    >
                        <Button onClick={onConnectServer}>
                            <Plus size={14} />
                            Connect server
                        </Button>
                    </EmptyState>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                    <span className="text-xs text-colorTextTertiary">
                        Connected in this project · {options.length}
                    </span>

                    <SearchInput
                        placeholder="Search servers"
                        aria-label="Search servers"
                        value={search}
                        onValueChange={setSearch}
                    />

                    {loading ? (
                        <div className="flex flex-col gap-2">
                            {SKELETON_WIDTHS.map((widths, index) => (
                                <RowSkeleton key={index} widths={widths} />
                            ))}
                        </div>
                    ) : visible.length === 0 ? (
                        <span className="text-xs text-colorTextTertiary">No servers match</span>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {visible.map((option) => (
                                <ConnectionListRow
                                    key={option.slug}
                                    name={option.name}
                                    host={option.host}
                                    toolCount={option.toolCount}
                                    state={rowState(option)}
                                    busy={busy}
                                    onAdd={() => void handleAdd(option)}
                                    onReconnect={() => onReconnect(option)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </EnhancedDrawer>
    )
}

export default McpAddServerDrawer
