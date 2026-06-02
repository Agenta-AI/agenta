import {useCallback, useMemo, useState} from "react"

import {
    useConnectionsQuery,
    useConnectionActions,
    catalogDrawerOpenAtom,
    executionDrawerAtom,
    fetchConnection,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {
    CatalogDrawer,
    ConnectionStatusBadge,
    ToolExecutionDrawer,
} from "@agenta/entity-ui/gatewayTool"
import {MoreOutlined} from "@ant-design/icons"
import {ArrowClockwise, Play, Plus, Trash, XCircle} from "@phosphor-icons/react"
import {Button, Dropdown, message, Table, Tag, Tooltip, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {getAgentaApiUrl, getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

export default function GatewayToolsSection() {
    const {connections, isLoading, refetch} = useConnectionsQuery()
    const {handleDelete, handleRefresh, handleRevoke, invalidateConnections} =
        useConnectionActions()
    const setCatalogOpen = useSetAtom(catalogDrawerOpenAtom)
    const setExecutionDrawer = useSetAtom(executionDrawerAtom)
    const [reloading, setReloading] = useState(false)

    const reloadAll = useCallback(async () => {
        setReloading(true)
        try {
            // Poll each connection individually to trigger Composio status sync
            await Promise.allSettled(
                connections
                    .map((c) => c.id)
                    .filter((id): id is string => typeof id === "string")
                    .map((id) => fetchConnection(id)),
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
                            await fetchConnection(connectionId)
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

    const columns: ColumnsType<ToolConnection> = useMemo(
        () => [
            {
                title: "Integration",
                key: "integration",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => (
                    <Tag
                        bordered={false}
                        color="default"
                        className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]"
                    >
                        {record.integration_key}
                    </Tag>
                ),
            },
            {
                title: "Name",
                key: "name",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => (
                    <Typography.Text>{record.name || record.slug}</Typography.Text>
                ),
            },
            {
                title: "Slug",
                dataIndex: "slug",
                key: "slug",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (slug: string) => <Typography.Text>{slug}</Typography.Text>,
            },
            {
                title: "Status",
                key: "status",
                onHeaderCell: () => ({
                    style: {minWidth: 120},
                }),
                render: (_, record) => <ConnectionStatusBadge connection={record} />,
            },
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (value: string) =>
                    value ? formatDay({date: value, outputFormat: "YYYY-MM-DD HH:mm"}) : "-",
            },
            {
                title: "",
                key: "actions",
                width: 48,
                fixed: "right",
                align: "center",
                render: (_, record) => (
                    <Dropdown
                        trigger={["click"]}
                        styles={{root: {width: 180}}}
                        menu={{
                            items: [
                                {
                                    key: "test",
                                    label: "Test",
                                    icon: <Play size={16} />,
                                    disabled: !(record.flags?.is_active && record.flags?.is_valid),
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        openExecution(record)
                                    },
                                },
                                {
                                    key: "refresh",
                                    label: "Refresh",
                                    icon: <ArrowClockwise size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        onRefresh(record)
                                    },
                                },
                                {
                                    key: "revoke",
                                    label: "Revoke",
                                    icon: <XCircle size={16} />,
                                    disabled: !record.flags?.is_valid,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        confirmRevoke(record)
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "delete",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        confirmDelete(record)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            onClick={(e) => e.stopPropagation()}
                            type="text"
                            aria-label="Open connection actions"
                            icon={<MoreOutlined />}
                        />
                    </Dropdown>
                ),
            },
        ],
        [confirmDelete, confirmRevoke, onRefresh, openExecution],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Typography.Text className="text-sm font-medium">
                        Third-party tool integrations
                    </Typography.Text>

                    <Button
                        icon={<Plus size={14} />}
                        type="primary"
                        size="small"
                        onClick={() => setCatalogOpen(true)}
                    >
                        Connect
                    </Button>
                    <Tooltip title="Reload all connections">
                        <Button
                            icon={<ArrowClockwise size={14} />}
                            type="text"
                            size="small"
                            aria-label="Reload all connections"
                            loading={reloading}
                            onClick={reloadAll}
                        />
                    </Tooltip>
                </div>

                <Table<ToolConnection>
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={connections}
                    rowKey="id"
                    bordered
                    pagination={false}
                    loading={isLoading}
                    onRow={(record) => ({
                        onClick: () => openExecution(record),
                        className: "cursor-pointer",
                    })}
                />
            </section>

            {/* Drawers */}
            <CatalogDrawer onConnectionCreated={refetch} />
            <ToolExecutionDrawer />
        </>
    )
}
