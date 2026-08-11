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
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {ArrowClockwise, Play, Plus, Trash, XCircle} from "@phosphor-icons/react"
import {Button, Input, message, Tag, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {getAgentaApiUrl, getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

const AUTH_SCHEME_LABELS: Record<string, string> = {
    oauth: "OAuth",
    api_key: "API Key",
}

export default function GatewayToolsSection() {
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
            AlertPopup({
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
        [handleDelete],
    )

    const confirmRevoke = useCallback(
        (connection: ToolConnection) => {
            AlertPopup({
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
        [handleRevoke],
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

    const columns = useMemo(
        () =>
            createStandardColumns<ToolRow>([
                {
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 200,
                    fixed: "left",
                    render: (_value, record) => (
                        <Typography.Text>{record.name || record.slug}</Typography.Text>
                    ),
                },
                {
                    type: "text",
                    key: "integration_key",
                    title: "Tool",
                    width: 180,
                    render: (_value, record) => (
                        <Tag
                            bordered={false}
                            color="default"
                            className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]"
                        >
                            {record.integration_key}
                        </Tag>
                    ),
                },
                // The slug is what you reference in code, so it gets its own copy button.
                {type: "slug", key: "slug", title: "Slug", width: 250},
                {
                    type: "text",
                    key: "auth_scheme",
                    title: "Auth",
                    width: 120,
                    render: (_value, record) => {
                        const scheme =
                            typeof record.data?.auth_scheme === "string"
                                ? record.data.auth_scheme
                                : undefined
                        if (!scheme) return <Typography.Text type="secondary">—</Typography.Text>
                        return <Tag>{AUTH_SCHEME_LABELS[scheme] ?? scheme}</Tag>
                    },
                },
                {
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 150,
                    render: (_value, record) => <ConnectionStatusBadge connection={record} />,
                },
                {
                    type: "text",
                    key: "created_at",
                    title: "Connected",
                    width: 160,
                    render: (_value, record) =>
                        record.created_at
                            ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                            : "-",
                },
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "run",
                            label: "Run tool",
                            icon: <Play size={16} />,
                            onClick: (record: ToolRow) => openExecution(record),
                        },
                        {
                            key: "refresh",
                            label: "Refresh",
                            icon: <ArrowClockwise size={16} />,
                            onClick: (record: ToolRow) => onRefresh(record),
                        },
                        {
                            key: "revoke",
                            label: "Revoke",
                            icon: <XCircle size={16} />,
                            onClick: (record: ToolRow) => confirmRevoke(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record: ToolRow) => confirmDelete(record),
                        },
                    ],
                } satisfies StandardColumnDef<ToolRow>,
            ]),
        [confirmDelete, confirmRevoke, onRefresh, openExecution],
    )

    const {tableScope, pagination} = useStaticTable<ToolRow>("settings-tools", rows, {
        loading: isLoading,
    })
    return (
        <>
            <section className="flex flex-col">
                <InfiniteVirtualTableFeatureShell<ToolRow>
                    className="ph-no-capture"
                    tableScope={tableScope}
                    autoHeight={false}
                    // No section title: Tools is a single-section page, so the page header
                    // already says what this is.
                    columns={columns}
                    rowKey={(record) => record.key}
                    pagination={pagination}
                    filters={
                        <Input.Search
                            placeholder="Search tools"
                            className="w-[260px]"
                            allowClear
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            disabled={isLoading}
                        />
                    }
                    primaryActions={
                        <>
                            <Tooltip title="Reload all connections">
                                <Button
                                    icon={<ArrowClockwise size={14} />}
                                    type="default"
                                    aria-label="Reload all connections"
                                    loading={reloading}
                                    onClick={reloadAll}
                                />
                            </Tooltip>
                            <Button
                                icon={<Plus size={14} />}
                                type="primary"
                                disabled={isLoading}
                                onClick={() => setCatalogOpen(true)}
                            >
                                Connect tool
                            </Button>
                        </>
                    }
                    tableProps={{
                        size: "small",
                        bordered: true,
                        tableLayout: "fixed",
                        locale: {
                            emptyText: searchTerm.trim() ? (
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
                                    <Button
                                        icon={<Plus size={14} />}
                                        onClick={() => setCatalogOpen(true)}
                                    >
                                        Connect tool
                                    </Button>
                                </EmptyState>
                            ),
                        },
                        onRow: (record: ToolRow) => ({
                            onClick: () => openExecution(record),
                            className: "cursor-pointer",
                        }),
                    }}
                />
            </section>

            <CatalogDrawer onConnectionCreated={refetch} />
            <ToolExecutionDrawer />
        </>
    )
}
