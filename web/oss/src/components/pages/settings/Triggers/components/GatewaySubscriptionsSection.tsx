import {useCallback, useMemo, useState} from "react"

import {
    isEntityActive,
    isEntityValid,
    triggerDeliveriesDrawerAtom,
    triggerSubscriptionDrawerAtom,
    useTriggerConnectionsQuery,
    useTriggerSubscription,
    useTriggerSubscriptions,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {ActiveToggle, TriggerSubscriptionDrawer} from "@agenta/entity-ui/gatewayTrigger"
import {MoreOutlined} from "@ant-design/icons"
import {
    ArrowClockwise,
    ArrowsClockwise,
    GearSix,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag, Tooltip, Typography, message} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

export default function GatewaySubscriptionsSection() {
    const {subscriptions, isLoading, refetch} = useTriggerSubscriptions()
    const {connections} = useTriggerConnectionsQuery()
    const {revoke, refresh, remove, setActive, isMutating} = useTriggerSubscription()
    const openDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openDeliveries = useSetAtom(triggerDeliveriesDrawerAtom)
    const [reloading, setReloading] = useState(false)

    const reloadAll = useCallback(async () => {
        setReloading(true)
        try {
            await refetch()
        } finally {
            setReloading(false)
        }
    }, [refetch])

    const connectionLabel = useCallback(
        (connectionId?: string) => {
            const c = connections.find((conn) => conn.id === connectionId)
            return c ? c.name || c.slug || c.integration_key : (connectionId ?? "-")
        },
        [connections],
    )

    const handleCreate = useCallback(() => openDrawer({}), [openDrawer])

    const handleEdit = useCallback(
        (record: TriggerSubscription) => openDrawer({subscriptionId: record.id ?? undefined}),
        [openDrawer],
    )

    const handleRevoke = useCallback(
        async (record: TriggerSubscription) => {
            if (!record.id) return
            try {
                await revoke(record.id)
                message.success("Subscription revoked")
            } catch {
                message.error("Failed to revoke subscription")
            }
        },
        [revoke],
    )

    const handleRefresh = useCallback(
        async (record: TriggerSubscription) => {
            if (!record.id) return
            try {
                await refresh(record.id)
                message.success("Subscription refreshed")
            } catch {
                message.error("Failed to refresh subscription")
            }
        },
        [refresh],
    )

    const handleDelete = useCallback(
        async (record: TriggerSubscription) => {
            if (!record.id) return
            try {
                await remove(record.id)
                message.success("Subscription deleted")
            } catch {
                message.error("Failed to delete subscription")
            }
        },
        [remove],
    )

    const handleToggle = useCallback(
        (record: TriggerSubscription) => async (next: boolean) => {
            if (!record.id) return
            await setActive(record.id, next)
        },
        [setActive],
    )

    const columns: ColumnsType<TriggerSubscription> = useMemo(
        () => [
            {
                title: "Name",
                key: "name",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => (
                    <Typography.Text>{record.name || record.id || "-"}</Typography.Text>
                ),
            },
            {
                title: "Connection",
                key: "connection",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => (
                    <Typography.Text>{connectionLabel(record.connection_id)}</Typography.Text>
                ),
            },
            {
                title: "Event",
                key: "event",
                onHeaderCell: () => ({style: {minWidth: 160}}),
                render: (_, record) => (
                    <Tag
                        bordered={false}
                        color="default"
                        className="bg-[var(--ag-c-0517290F)] px-2 py-[1px]"
                    >
                        {record.data?.event_key ?? "-"}
                    </Tag>
                ),
            },
            {
                title: "Status",
                key: "status",
                onHeaderCell: () => ({style: {minWidth: 120}}),
                render: (_, record) =>
                    // WP1: top-level `enabled`/`valid` are gone; read flags.
                    !isEntityValid(record) ? (
                        <Tag color="red">Invalid</Tag>
                    ) : isEntityActive(record) ? (
                        <Tag color="green">Active</Tag>
                    ) : (
                        <Tag>Paused</Tag>
                    ),
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
                width: 96,
                fixed: "right" as const,
                align: "center" as const,
                render: (_, record) => (
                    <div className="flex items-center justify-center gap-1">
                        <ActiveToggle
                            active={isEntityActive(record)}
                            onToggle={handleToggle(record)}
                            disabled={!record.id || !isEntityValid(record)}
                            activatedMessage="Subscription resumed"
                            pausedMessage="Subscription paused"
                            errorMessage="Failed to update subscription"
                        />
                        <Dropdown
                            trigger={["click"]}
                            styles={{root: {width: 180}}}
                            menu={{
                                items: [
                                    {
                                        key: "deliveries",
                                        label: "View deliveries",
                                        icon: <ListChecks size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            if (record.id)
                                                openDeliveries({
                                                    owner: {kind: "subscription", id: record.id},
                                                    name: record.name ?? undefined,
                                                })
                                        },
                                    },
                                    {
                                        key: "edit",
                                        label: "Edit",
                                        icon: <PencilSimpleLine size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleEdit(record)
                                        },
                                    },
                                    {
                                        key: "refresh",
                                        label: "Refresh",
                                        icon: <ArrowsClockwise size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleRefresh(record)
                                        },
                                    },
                                    {type: "divider" as const},
                                    {
                                        key: "revoke",
                                        label: "Revoke",
                                        icon: <XCircle size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleRevoke(record)
                                        },
                                    },
                                    {
                                        key: "delete",
                                        label: "Delete",
                                        icon: <Trash size={16} />,
                                        danger: true,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleDelete(record)
                                        },
                                    },
                                ],
                            }}
                        >
                            <Button
                                type="text"
                                icon={<MoreOutlined />}
                                aria-label="Open subscription actions"
                                onClick={(e) => e.stopPropagation()}
                            />
                        </Dropdown>
                    </div>
                ),
            },
        ],
        [
            connectionLabel,
            handleDelete,
            handleEdit,
            handleRefresh,
            handleRevoke,
            handleToggle,
            openDeliveries,
        ],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Button
                        type="primary"
                        size="small"
                        icon={<Plus size={14} />}
                        onClick={handleCreate}
                        disabled={connections.length === 0}
                    >
                        Subscribe
                    </Button>
                    <Tooltip title="Reload all subscriptions">
                        <Button
                            icon={<ArrowClockwise size={14} />}
                            type="text"
                            size="small"
                            aria-label="Reload all subscriptions"
                            loading={reloading}
                            onClick={reloadAll}
                        />
                    </Tooltip>
                </div>

                <Table<TriggerSubscription>
                    className="ph-no-capture"
                    columns={columns}
                    dataSource={subscriptions}
                    rowKey={(record) => record.id ?? record.slug ?? record.data?.event_key ?? ""}
                    bordered
                    pagination={false}
                    loading={isLoading || isMutating}
                    onRow={(record) => ({
                        onClick: () => handleEdit(record),
                        className: "cursor-pointer",
                    })}
                />
            </section>

            <TriggerSubscriptionDrawer />
        </>
    )
}
