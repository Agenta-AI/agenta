/**
 * "Add MCP server" (F03 f4): pick one of the project's MCP connections for this agent, or
 * connect a new one.
 *
 * Presentational: every connection arrives as a prop and every write goes back out as a
 * callback. The view that mounts it reads `mcpEndpointsQueryAtom`, opens the connect step and
 * gives the chrome with "Done".
 */
import {useMemo, useState} from "react"

import type {McpConnectionStatus} from "@agenta/entities/mcpEndpoint"
import {useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {McpServerMark} from "@agenta/ui/agent-icon"
import {Button, EmptyState, SearchInput, SkeletonRows} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import {ScrollFadeArea} from "../shared/ScrollFadeArea"

import {ConnectionListRow} from "./components/ConnectionListRow"

/** One connection in the project registry, as this drawer needs it. */
export interface McpConnectionOption {
    /** The slug the gateway resolves at run time, and this row's key. */
    slug: string
    name: string
    host: string
    /** Null unless the connection record carries a cached count; see ConnectionListRow. */
    toolCount?: number | null
    status: McpConnectionStatus
    /** Already on the agent being edited. */
    added?: boolean
}

export interface McpAddServerListProps {
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

export function McpAddServerList({
    options,
    loading,
    onConnectServer,
    onAdd,
    onReconnect,
}: McpAddServerListProps) {
    const t = useT(mcpConnectCatalog)
    const [search, setSearch] = useState("")
    // One write in flight at a time: two overlapping adds both start from the same array.
    const [busy, setBusy] = useState(false)

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

    // The empty project, which is a different screen from an empty search: it carries the
    // only call to action and the header button goes away, where a fruitless search keeps
    // the header button and says so inline.
    const emptyProject = !loading && options.length === 0

    if (emptyProject) {
        return (
            <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState
                    className="max-w-[320px] text-center"
                    image={<McpServerMark size={44} />}
                    title={t("entityUi.mcpConnect.noServersYet")}
                    description={t("entityUi.mcpConnect.noServersYetBody")}
                >
                    <Button onClick={onConnectServer}>
                        <Plus size={14} />
                        {t("entityUi.mcpConnect.connectServer")}
                    </Button>
                </EmptyState>
            </div>
        )
    }

    return (
        <ScrollFadeArea className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
                <SearchInput
                    className="min-w-0 flex-1"
                    placeholder={t("entityUi.mcpConnect.searchServers")}
                    aria-label={t("entityUi.mcpConnect.searchServers")}
                    value={search}
                    onValueChange={setSearch}
                />
                {/* Secondary: adding a connected server is this list's main job. */}
                <Button variant="outline" onClick={onConnectServer}>
                    <Plus size={13} />
                    {t("entityUi.mcpConnect.connectServer")}
                </Button>
            </div>

            {loading ? (
                <SkeletonRows rowClassName="h-[58px]" />
            ) : visible.length === 0 ? (
                <span className="text-xs text-colorTextTertiary">
                    {t("entityUi.mcpConnect.noServersMatch")}
                </span>
            ) : (
                <div className="flex flex-col gap-2">
                    {visible.map((option) => (
                        <ConnectionListRow
                            key={option.slug}
                            name={option.name}
                            host={option.host}
                            status={option.status}
                            added={option.added}
                            toolCount={option.toolCount}
                            busy={busy}
                            onAdd={() => void handleAdd(option)}
                            onReconnect={() => onReconnect(option)}
                        />
                    ))}
                </div>
            )}
        </ScrollFadeArea>
    )
}
