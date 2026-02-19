import {useMemo, useState} from "react"

import {ArrowsClockwise, GearSix, Play, Plus, Trash, XCircle} from "@phosphor-icons/react"
import {Button, message, Table, Tag, Tooltip, Typography} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {
    useConnectionsQuery,
    useConnectionActions,
    catalogDrawerOpenAtom,
    executionDrawerAtom,
} from "@/oss/features/gateway-tools"
import CatalogDrawer from "@/oss/features/gateway-tools/drawers/CatalogDrawer"
import ToolExecutionDrawer from "@/oss/features/gateway-tools/drawers/ToolExecutionDrawer"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {fetchConnection} from "@/oss/services/tools/api"
import type {ConnectionItem} from "@/oss/services/tools/api/types"

import ConnectionStatusBadge from "./ConnectionStatusBadge"

export default function GatewayToolsSection() {
    const {connections, isLoading, refetch} = useConnectionsQuery()
    const {handleDelete, handleRefresh, handleRevoke, invalidateConnections} =
        useConnectionActions()
    const setCatalogOpen = useSetAtom(catalogDrawerOpenAtom)
    const setExecutionDrawer = useSetAtom(executionDrawerAtom)
    const [actionLoading, setActionLoading] = useState<string | null>(null)
    const [reloading, setReloading] = useState(false)

    const reloadAll = async () => {
        setReloading(true)
        try {
            // Poll each connection individually to trigger Composio status sync
            await Promise.allSettled(connections.map((c) => fetchConnection(c.id)))
            invalidateConnections()
        } finally {
            setReloading(false)
        }
    }

    const openExecution = (record: ConnectionItem) => {
        setExecutionDrawer({
            connectionId: record.id,
            connectionSlug: record.slug,
            integrationKey: record.integration_key,
        })
    }

    const onRefresh = async (connection: ConnectionItem) => {
        setActionLoading(`refresh-${connection.id}`)
        try {
            const result = await handleRefresh(connection.id)

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
                        await fetchConnection(connection.id)
                    } catch {
                        /* best-effort */
                    }
                    invalidateConnections()
                    setActionLoading(null)
                    message.success("Connection refreshed")
                }

                const handler = (event: MessageEvent) => {
                    if (event.data?.type === "tools:oauth:complete") {
                        window.removeEventListener("message", handler)
                        cleanup()
                    }
                }
                window.addEventListener("message", handler)

                // Fallback: detect popup closed
                const pollTimer = setInterval(() => {
                    if (popup && popup.closed) {
                        clearInterval(pollTimer)
                        window.removeEventListener("message", handler)
                        cleanup()
                    }
                }, 1000)
            } else {
                message.success("Connection refreshed")
                setActionLoading(null)
            }
        } catch {
            message.error("Failed to refresh connection")
            setActionLoading(null)
        }
    }

    const confirmDelete = (connection: ConnectionItem) => {
        AlertPopup({
            title: "Delete Connection",
            message:
                "Are you sure you want to delete this connection? This action is irreversible.",
            onOk: async () => {
                setActionLoading(`delete-${connection.id}`)
                try {
                    await handleDelete(connection.id)
                    message.success("Connection deleted")
                } catch {
                    message.error("Failed to delete connection")
                } finally {
                    setActionLoading(null)
                }
            },
        })
    }

    const confirmRevoke = (connection: ConnectionItem) => {
        AlertPopup({
            title: "Revoke Connection",
            message:
                "This will mark the connection as invalid. You can refresh it later to reactivate.",
            onOk: async () => {
                setActionLoading(`revoke-${connection.id}`)
                try {
                    await handleRevoke(connection.id)
                    message.success("Connection revoked")
                } catch {
                    message.error("Failed to revoke connection")
                } finally {
                    setActionLoading(null)
                }
            },
        })
    }

    const columns: ColumnsType<ConnectionItem> = useMemo(
        () => [
            {
                title: "Integration",
                key: "integration",
                onHeaderCell: () => ({
                    style: {minWidth: 160},
                }),
                render: (_, record) => (
                    <Tag bordered={false} color="default" className="bg-[#0517290F] px-2 py-[1px]">
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
                title: <GearSix size={16} />,
                key: "actions",
                width: 160,
                fixed: "right",
                align: "center",
                render: (_, record) => (
                    <div className="flex items-center gap-1">
                        <Tooltip title="Test">
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    openExecution(record)
                                }}
                                type="text"
                                icon={<Play />}
                                size="small"
                                disabled={!(record.flags?.is_active && record.flags?.is_valid)}
                            />
                        </Tooltip>
                        <Tooltip title="Refresh">
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onRefresh(record)
                                }}
                                type="text"
                                icon={<ArrowsClockwise />}
                                size="small"
                                loading={actionLoading === `refresh-${record.id}`}
                            />
                        </Tooltip>
                        <Tooltip title="Revoke">
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    confirmRevoke(record)
                                }}
                                type="text"
                                icon={<XCircle />}
                                size="small"
                                disabled={!record.flags?.is_valid}
                                loading={actionLoading === `revoke-${record.id}`}
                            />
                        </Tooltip>
                        <Tooltip title="Delete">
                            <Button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    confirmDelete(record)
                                }}
                                color="danger"
                                variant="text"
                                icon={<Trash />}
                                size="small"
                                loading={actionLoading === `delete-${record.id}`}
                            />
                        </Tooltip>
                    </div>
                ),
            },
        ],
        [actionLoading, handleRefresh, handleRevoke, handleDelete, setExecutionDrawer],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Typography.Text className="text-sm font-medium">
                        Composio integrations
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
                            icon={<ArrowsClockwise size={14} />}
                            type="text"
                            size="small"
                            loading={reloading}
                            onClick={reloadAll}
                        />
                    </Tooltip>
                </div>

                <Table<ConnectionItem>
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
