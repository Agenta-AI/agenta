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
import commonCatalog from "@agenta/i18n/catalogs/common"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {McpServerMark} from "@agenta/ui/agent-icon"
import {EmptyState, SearchInput} from "@agenta/ui/composed"
import {
    Alert,
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {MagnifyingGlass, Plus} from "@phosphor-icons/react"

import {CatalogGroupSkeleton} from "../DrillInView/SchemaControls/agentTemplate/CatalogRowSkeleton"
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
    /** The registry read failed; the list says so and offers Retry. */
    error?: boolean
    onRetry?: () => void
    /** Opens the connect sheet. The one hero action, and the empty state's only action. */
    onConnectServer: () => void
    /** Adds the connection to the agent. May be async; actions are disabled until it settles. */
    onAdd: (option: McpConnectionOption) => void | Promise<void>
    /** Runs the auth step alone for an expired login. */
    onReconnect: (option: McpConnectionOption) => void
    /** Re-reads the servers, from a connected row's menu. */
    onRefresh?: () => void
    /** Deletes the connection from the project; the host confirms first. */
    onDelete?: (option: McpConnectionOption) => void
    /** An added row's "Remove from agent"; the host asks first. */
    onRemoveFromAgent?: (option: McpConnectionOption) => void
}

export function McpAddServerList({
    options,
    loading,
    error,
    onRetry,
    onConnectServer,
    onAdd,
    onReconnect,
    onRefresh,
    onDelete,
    onRemoveFromAgent,
}: McpAddServerListProps) {
    const t = useT(mcpConnectCatalog, commonCatalog)
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

    // Connected first, as the integration catalog groups its rows.
    const groups = useMemo(
        () =>
            [
                {
                    key: "connected",
                    label: t("common.connected"),
                    rows: visible.filter((o) => o.status === "connected"),
                },
                {
                    key: "notConnected",
                    label: t("common.notConnected"),
                    rows: visible.filter((o) => o.status !== "connected"),
                },
            ].filter((group) => group.rows.length > 0),
        [visible, t],
    )

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
    const emptyProject = !loading && !error && options.length === 0

    if (emptyProject) {
        return (
            <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState
                    className="max-w-popover-md text-center"
                    image={<McpServerMark size={40} />}
                    title={t("entityUi.mcpConnect.noServersYet")}
                    description={t("entityUi.mcpConnect.noServersYetBody")}
                >
                    <Button onClick={onConnectServer}>
                        <Plus />
                        {t("entityUi.mcpConnect.connectServer")}
                    </Button>
                </EmptyState>
            </div>
        )
    }

    // The integration catalog's layout: a fixed search row above one scroll (CONS-02).
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* pt-1 keeps the focus ring inside the body's clip. */}
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-1">
                <SearchInput
                    className="min-w-0 flex-1 border-border-muted"
                    placeholder={t("entityUi.mcpConnect.searchServers")}
                    aria-label={t("entityUi.mcpConnect.searchServers")}
                    value={search}
                    onValueChange={setSearch}
                />
                {/* Secondary: adding a connected server is this list's main job. */}
                <Button variant="outline" onClick={onConnectServer}>
                    <Plus />
                    {t("entityUi.mcpConnect.connectServer")}
                </Button>
            </div>

            <ScrollFadeArea className="flex min-h-0 flex-1 flex-col px-4 pb-3">
                {loading ? (
                    <CatalogGroupSkeleton rows={3} />
                ) : error ? (
                    <Alert
                        type="warning"
                        showIcon
                        message={t("entityUi.mcpConnect.serversUnavailable")}
                        description={
                            <div className="flex items-start justify-between gap-4">
                                <span>{t("entityUi.mcpConnect.serversUnavailableDetail")}</span>
                                {onRetry ? (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="shrink-0"
                                        onClick={onRetry}
                                    >
                                        {t("common.retry")}
                                    </Button>
                                ) : null}
                            </div>
                        }
                    />
                ) : visible.length === 0 ? (
                    <Empty className="py-10">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <MagnifyingGlass />
                            </EmptyMedia>
                            <EmptyTitle>{t("entityUi.mcpConnect.noServersMatch")}</EmptyTitle>
                            <EmptyDescription>
                                {t("entityUi.mcpConnect.tryAnotherNameOrHost")}
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button variant="outline" onClick={() => setSearch("")}>
                                {t("common.clearSearch")}
                            </Button>
                        </EmptyContent>
                    </Empty>
                ) : (
                    <div className="flex flex-col gap-2">
                        {groups.map((group) => (
                            // The integration catalog's group: a heading, 8px, then the rows.
                            <section key={group.key} className="flex flex-col gap-2">
                                <div className="flex items-center pt-3 text-subtitle text-foreground">
                                    {group.label}
                                </div>
                                {group.rows.map((option) => (
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
                                        onRefresh={onRefresh}
                                        onDelete={onDelete ? () => onDelete(option) : undefined}
                                        onRemoveFromAgent={
                                            onRemoveFromAgent
                                                ? () => onRemoveFromAgent(option)
                                                : undefined
                                        }
                                    />
                                ))}
                            </section>
                        ))}
                    </div>
                )}
            </ScrollFadeArea>
        </div>
    )
}
