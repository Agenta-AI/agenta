import {useCallback, useMemo, useState} from "react"

import {
    fetchToolConnection,
    toolCatalogDrawerOpenAtom,
    toolExecutionDrawerAtom,
    useToolConnectionActions,
    useToolConnectionsQuery,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {
    CatalogDrawer,
    ConnectionStatusBadge,
    ToolExecutionDrawer,
} from "@agenta/entity-ui/gatewayTool"
import {getAgentaApiUrl, getAgentaWebUrl} from "@agenta/shared/api"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {message} from "@agenta/ui/app-message"
import {InitialsAvatar, Tag} from "@agenta/ui/components/presentational"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {ArrowClockwise, Play, Plus, Trash, XCircle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import type {ConfirmDestructive} from "../confirm"

import {useToolsIntegrations} from "./hooks/useToolsIntegrations"

const AUTH_SCHEME_LABELS: Record<string, string> = {
    oauth: "OAuth",
    api_key: "API Key",
}

export interface GatewayToolsSectionProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: ConfirmDestructive
    /** Hides connect/run and skips the catalog drawer, whose schema form is still antd-backed. */
    readOnly?: boolean
}

export default function GatewayToolsSection({confirm, readOnly}: GatewayToolsSectionProps) {
    const {connections, isLoading, refetch} = useToolConnectionsQuery()
    const {handleDelete, handleRefresh, handleRevoke, invalidateConnections} =
        useToolConnectionActions()
    const setCatalogOpen = useSetAtom(toolCatalogDrawerOpenAtom)
    const setExecutionDrawer = useSetAtom(toolExecutionDrawerAtom)
    const [reloading, setReloading] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")

    const reloadAll = useCallback(async () => {
        setReloading(true)
        try {
            // Poll each connection individually to trigger Composio status sync
            await Promise.allSettled(
                connections
                    .map((c) => c.id)
                    .filter((id): id is string => typeof id === "string")
                    .map((id) => fetchToolConnection(id)),
            )
            invalidateConnections()
        } finally {
            setReloading(false)
        }
    }, [connections, invalidateConnections])

    const openExecution = useCallback(
        (record: ToolConnection) => {
            if (!record.id || !record.slug) return
            setExecutionDrawer({
                connectionId: record.id,
                connectionSlug: record.slug,
                integrationKey: record.integration_key,
            })
        },
        [setExecutionDrawer],
    )

    const onRefresh = useCallback(
        async (connection: ToolConnection) => {
            if (!connection.id) return
            const connectionId = connection.id
            try {
                const result = await handleRefresh(connectionId)

                const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                    ?.redirect_url

                if (typeof redirectUrl === "string" && redirectUrl) {
                    // OAuth re-auth: open popup and wait for completion
                    const popup = window.open(
                        redirectUrl,
                        "tools_oauth",
                        "width=600,height=700,popup=yes",
                    )

                    const cleanup = async () => {
                        window.focus()
                        // Poll the individual connection endpoint which checks
                        // Composio for status and updates is_valid in the DB.
                        try {
                            await fetchToolConnection(connectionId)
                        } catch {
                            /* best-effort */
                        }
                        invalidateConnections()
                        message.success("Connection refreshed")
                    }

                    const trustedOrigins = new Set<string>([window.location.origin])
                    for (const url of [getAgentaApiUrl(), getAgentaWebUrl()]) {
                        if (!url) continue
                        try {
                            trustedOrigins.add(new URL(url).origin)
                        } catch {
                            // ignore invalid env URLs
                        }
                    }

                    const handler = (event: MessageEvent) => {
                        if (
                            event.data?.type === "tools:oauth:complete" &&
                            trustedOrigins.has(event.origin)
                        ) {
                            window.removeEventListener("message", handler)
                            void cleanup()
                        }
                    }
                    window.addEventListener("message", handler)

                    // Fallback: detect popup closed
                    const pollTimer = setInterval(() => {
                        if (popup && popup.closed) {
                            clearInterval(pollTimer)
                            window.removeEventListener("message", handler)
                            void cleanup()
                        }
                    }, 1000)
                } else {
                    message.success("Connection refreshed")
                }
            } catch {
                message.error("Failed to refresh connection")
            }
        },
        [handleRefresh, invalidateConnections],
    )

    const confirmDelete = useCallback(
        (connection: ToolConnection) => {
            confirm?.({
                title: "Delete Connection",
                message:
                    "Are you sure you want to delete this connection? This action is irreversible.",
                onOk: async () => {
                    if (!connection.id) return
                    try {
                        await handleDelete(connection.id)
                        message.success("Connection deleted")
                    } catch {
                        message.error("Failed to delete connection")
                    }
                },
            })
        },
        [confirm, handleDelete],
    )

    const confirmRevoke = useCallback(
        (connection: ToolConnection) => {
            confirm?.({
                title: "Revoke Connection",
                message:
                    "This will mark the connection as invalid. You can refresh it later to reactivate.",
                onOk: async () => {
                    if (!connection.id) return
                    try {
                        await handleRevoke(connection.id)
                        message.success("Connection revoked")
                    } catch {
                        message.error("Failed to revoke connection")
                    }
                },
            })
        },
        [confirm, handleRevoke],
    )

    interface ToolRow extends ToolConnection {
        key: string
        [extra: string]: unknown
    }

    const rows = useMemo<ToolRow[]>(() => {
        const all = (connections ?? []).map((connection, index) => ({
            ...connection,
            key: connection.id ?? connection.slug ?? connection.integration_key ?? `tool-${index}`,
        }))
        const term = searchTerm.trim().toLowerCase()
        if (!term) return all
        return all.filter((connection) =>
            [connection.name, connection.slug, connection.integration_key].some((value) =>
                value?.toLowerCase().includes(term),
            ),
        )
    }, [connections, searchTerm])

    // The catalog is already cached for the Connect drawer, so this is a lookup, not a fetch.
    const {integrations} = useToolsIntegrations()
    const logoFor = useCallback(
        (key?: string | null) =>
            (key && integrations.find((integration) => integration.key === key)?.logo) || undefined,
        [integrations],
    )

    const columns = useMemo<DataTableColumn<ToolRow>[]>(
        () => [
            {
                key: "name",
                title: "Name",
                width: 200,
                render: (record) => {
                    const label = record.name || record.slug || "—"
                    const logo = logoFor(record.integration_key)
                    return (
                        <div className="flex min-w-0 items-center gap-2">
                            {/* The catalog's own artwork, so a connection reads as the app it
                                is. Initials stand in when the catalog has no logo, which keeps
                                every row's text on the same left edge. */}
                            {logo ? (
                                <img
                                    src={logo}
                                    alt=""
                                    aria-hidden
                                    className="size-6 shrink-0 rounded object-contain"
                                />
                            ) : (
                                <InitialsAvatar size="small" name={label} />
                            )}
                            <span className="truncate" title={label}>
                                {label}
                            </span>
                        </div>
                    )
                },
            },
            {
                key: "integration_key",
                title: "Tool",
                width: 180,
                render: (record) => <Tag>{record.integration_key}</Tag>,
            },
            {key: "slug", title: "Slug", width: 250, mono: true, render: (r) => r.slug},
            {
                key: "auth_scheme",
                title: "Auth",
                width: 120,
                render: (record) => {
                    const scheme =
                        typeof record.data?.auth_scheme === "string"
                            ? record.data.auth_scheme
                            : undefined
                    if (!scheme) return <span className="text-colorTextSecondary">—</span>
                    return <Tag>{AUTH_SCHEME_LABELS[scheme] ?? scheme}</Tag>
                },
            },
            {
                key: "status",
                title: "Status",
                width: 150,
                render: (record) => <ConnectionStatusBadge connection={record} />,
            },
            {
                key: "created_at",
                title: "Connected",
                width: 160,
                render: (record) =>
                    record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
        ],
        [logoFor],
    )
    return (
        <>
            <section className="flex flex-col">
                <DataTable<ToolRow>
                    className="ph-no-capture"
                    // No section title: Tools is a single-section page, so the page header
                    // already says what this is.
                    columns={columns}
                    rows={rows}
                    rowKey={(record) => record.key}
                    loading={isLoading}
                    onRowClick={readOnly ? undefined : openExecution}
                    actions={(record) => [
                        {
                            key: "run",
                            hidden: readOnly,
                            label: "Run tool",
                            icon: <Play size={16} />,
                            onClick: () => openExecution(record),
                        },
                        {
                            key: "refresh",
                            hidden: readOnly,
                            label: "Refresh",
                            icon: <ArrowClockwise size={16} />,
                            onClick: () => onRefresh(record),
                        },
                        {
                            key: "revoke",
                            label: "Revoke",
                            icon: <XCircle size={16} />,
                            hidden: !confirm,
                            onClick: () => confirmRevoke(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            hidden: !confirm,
                            onClick: () => confirmDelete(record),
                        },
                    ]}
                    search={{
                        placeholder: "Search tools",
                        value: searchTerm,
                        onChange: setSearchTerm,
                        disabled: isLoading,
                    }}
                    onReload={reloadAll}
                    reloading={reloading}
                    reloadLabel="Reload all connections"
                    primaryActions={
                        <>
                            {readOnly ? null : (
                                <Button disabled={isLoading} onClick={() => setCatalogOpen(true)}>
                                    <Plus size={14} />
                                    Connect tool
                                </Button>
                            )}
                        </>
                    }
                    empty={
                        searchTerm.trim() ? (
                            <EmptyState
                                image="simple"
                                description={`No tools match “${searchTerm.trim()}”`}
                            />
                        ) : (
                            <EmptyState
                                image="simple"
                                description={
                                    <div className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-colorText">
                                            No tools connected yet
                                        </span>
                                        <span>Connect a tool to let your agents call it.</span>
                                    </div>
                                }
                            >
                                {readOnly ? null : (
                                    <Button variant="outline" onClick={() => setCatalogOpen(true)}>
                                        <Plus size={14} />
                                        Connect tool
                                    </Button>
                                )}
                            </EmptyState>
                        )
                    }
                />
            </section>

            {readOnly ? null : <CatalogDrawer onConnectionCreated={refetch} />}
            {readOnly ? null : <ToolExecutionDrawer />}
        </>
    )
}
