import {useCallback, useMemo, useState} from "react"

import {
    fetchTriggerConnection,
    triggerCatalogDrawerOpenAtom,
    triggerEventsDrawerAtom,
    useTriggerConnectionActions,
    useTriggerConnectionsQuery,
    type TriggerConnection,
} from "@agenta/entities/gatewayTrigger"
import {ConnectionStatusBadge} from "@agenta/entity-ui/gatewayTool"
import {TriggerCatalogDrawer, TriggerEventsDrawer} from "@agenta/entity-ui/gatewayTrigger"
import {MoreOutlined} from "@ant-design/icons"
import {
    ArrowClockwise,
    GearSix,
    Lightning,
    PlugsConnected,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag, Tooltip, Typography, message} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

import {TriggerEmptyState, TriggerSectionHeader} from "./TriggerSection"

const DEFAULT_PROVIDER = "composio"

export default function GatewayTriggersSection() {
    const {connections, isLoading, refetch} = useTriggerConnectionsQuery()
    const {handleDelete, handleRefresh, handleRevoke, invalidateConnections} =
        useTriggerConnectionActions()
    const setEventsDrawer = useSetAtom(triggerEventsDrawerAtom)
    const setCatalogOpen = useSetAtom(triggerCatalogDrawerOpenAtom)
    const [reloading, setReloading] = useState(false)

    const reloadAll = useCallback(async () => {
        setReloading(true)
        try {
            // Poll each connection individually to trigger Composio status sync.
            await Promise.allSettled(
                connections
                    .map((c) => c.id)
                    .filter((id): id is string => typeof id === "string")
                    .map((id) => fetchTriggerConnection(id)),
            )
            invalidateConnections()
        } finally {
            setReloading(false)
        }
    }, [connections, invalidateConnections])

    const openEvents = useCallback(
        (record: TriggerConnection) => {
            setEventsDrawer({
                providerKey: record.provider_key ?? DEFAULT_PROVIDER,
                integrationKey: record.integration_key,
                integrationName: record.name ?? record.slug ?? record.integration_key,
                connectionId: record.id ?? undefined,
            })
        },
        [setEventsDrawer],
    )

    const onRefresh = useCallback(
        async (connection: TriggerConnection) => {
            if (!connection.id) return
            try {
                await handleRefresh(connection.id)
                message.success("Connection refreshed")
            } catch {
                message.error("Failed to refresh connection")
            }
        },
        [handleRefresh],
    )

    const confirmRevoke = useCallback(
        (connection: TriggerConnection) => {
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

    const confirmDelete = useCallback(
        (connection: TriggerConnection) => {
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

    const columns: ColumnsType<TriggerConnection> = useMemo(
        () => [
            {
                title: "Integration",
                key: "integration",
                onHeaderCell: () => ({style: {minWidth: 160}}),
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
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => (
                    <Typography.Text>{record.name || record.slug}</Typography.Text>
                ),
            },
            {
                title: "Slug",
                dataIndex: "slug",
                key: "slug",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (slug: string) => <Typography.Text>{slug}</Typography.Text>,
            },
            {
                title: "Status",
                key: "status",
                onHeaderCell: () => ({style: {minWidth: 120}}),
                render: (_, record) => <ConnectionStatusBadge connection={record} />,
            },
            {
                title: "Created at",
                dataIndex: "created_at",
                key: "created_at",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (value: string) =>
                    value ? formatDay({date: value, outputFormat: "YYYY-MM-DD HH:mm"}) : "-",
            },
            {
                title: <GearSix size={16} />,
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
                                    key: "events",
                                    label: "Browse events",
                                    icon: <Lightning size={16} />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        openEvents(record)
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
        [openEvents, onRefresh, confirmRevoke, confirmDelete],
    )

    return (
        <>
            <section className="flex flex-col gap-3">
                <TriggerSectionHeader
                    icon={<PlugsConnected size={16} />}
                    title="Connections"
                    description="Link an app like GitHub or Slack so its events can trigger your workflows."
                    actions={
                        <>
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
                            <Button
                                icon={<Plus size={14} />}
                                type="primary"
                                size="small"
                                onClick={() => setCatalogOpen(true)}
                            >
                                Connect
                            </Button>
                        </>
                    }
                />

                <Table<TriggerConnection>
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={connections}
                    rowKey={(record) => record.id ?? record.slug ?? record.integration_key}
                    bordered
                    pagination={false}
                    loading={isLoading}
                    locale={{
                        emptyText: isLoading ? (
                            <span />
                        ) : (
                            <TriggerEmptyState
                                icon={<PlugsConnected size={32} />}
                                title="No connections yet"
                                description="Connect an app to start receiving its events. You can then subscribe workflows to those events."
                            />
                        ),
                    }}
                    onRow={(record) => ({
                        onClick: () => openEvents(record),
                        className: "cursor-pointer",
                    })}
                />
            </section>

            <TriggerCatalogDrawer onConnectionCreated={refetch} />
            <TriggerEventsDrawer />
        </>
    )
}
