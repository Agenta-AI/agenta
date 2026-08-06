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
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {
    ArrowClockwise,
    ArrowsClockwise,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography, message} from "antd"
import {useSetAtom} from "jotai"

import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
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

    interface SubscriptionRow extends TriggerSubscription {
        key: string
        [extra: string]: unknown
    }

    const rows = useMemo<SubscriptionRow[]>(
        () =>
            (subscriptions ?? []).map((subscription, index) => ({
                ...subscription,
                key:
                    subscription.id ??
                    subscription.slug ??
                    subscription.data?.event_key ??
                    `subscription-${index}`,
            })),
        [subscriptions],
    )

    const columns = useMemo(
        () =>
            createStandardColumns<SubscriptionRow>([
                {
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 200,
                    render: (_value, record) => (
                        <Typography.Text>{record.name || record.id || "-"}</Typography.Text>
                    ),
                },
                {
                    type: "text",
                    key: "connection",
                    title: "Connection",
                    width: 200,
                    render: (_value, record) => connectionLabel(record.connection_id),
                },
                {
                    type: "text",
                    key: "event",
                    title: "Event",
                    width: 220,
                    render: (_value, record) => (
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
                    // The toggle shows the state and changes it, so it lives in Status.
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 140,
                    render: (_value, record) =>
                        !isEntityValid(record) ? (
                            <StatusIndicator tone="error" label="Invalid" />
                        ) : (
                            <div onClick={(event) => event.stopPropagation()}>
                                <ActiveToggle
                                    active={isEntityActive(record)}
                                    onToggle={handleToggle(record)}
                                    disabled={!record.id}
                                    activatedMessage="Subscription resumed"
                                    pausedMessage="Subscription paused"
                                    errorMessage="Failed to update subscription"
                                />
                            </div>
                        ),
                },
                {
                    type: "text",
                    key: "created_at",
                    title: "Created",
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
                            key: "deliveries",
                            label: "View deliveries",
                            icon: <ListChecks size={16} />,
                            onClick: (record: SubscriptionRow) => {
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
                            onClick: (record: SubscriptionRow) => handleEdit(record),
                        },
                        {
                            key: "refresh",
                            label: "Refresh",
                            icon: <ArrowsClockwise size={16} />,
                            onClick: (record: SubscriptionRow) => handleRefresh(record),
                        },
                        {
                            key: "revoke",
                            label: "Revoke",
                            icon: <XCircle size={16} />,
                            onClick: (record: SubscriptionRow) => handleRevoke(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record: SubscriptionRow) => handleDelete(record),
                        },
                    ],
                } satisfies StandardColumnDef<SubscriptionRow>,
            ]),
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

    const {tableScope, pagination} = useStaticTable<SubscriptionRow>(
        "settings-trigger-subscriptions",
        rows,
    )
    return (
        <>
            <section className="flex flex-col">
                <InfiniteVirtualTableFeatureShell<SubscriptionRow>
                    className="ph-no-capture"
                    tableScope={tableScope}
                    autoHeight={false}
                    emptyMinHeight={250}
                    title={
                        <div className="flex flex-col gap-1">
                            <h3 className="m-0 font-medium text-colorText">Event triggers</h3>
                            <p className="m-0 font-normal text-colorTextSecondary">
                                Run a workflow whenever an event fires in a connected app.
                            </p>
                        </div>
                    }
                    columns={columns}
                    rowKey={(record) => record.key}
                    pagination={pagination}
                    primaryActions={
                        <>
                            <Tooltip title="Reload all event triggers">
                                <Button
                                    icon={<ArrowClockwise size={14} />}
                                    type="default"
                                    aria-label="Reload all event triggers"
                                    loading={reloading}
                                    onClick={reloadAll}
                                />
                            </Tooltip>
                            <Tooltip
                                title={
                                    connections.length === 0 ? "Connect an app first" : undefined
                                }
                            >
                                <Button
                                    type="primary"
                                    icon={<Plus size={14} />}
                                    onClick={handleCreate}
                                    disabled={connections.length === 0}
                                >
                                    Subscribe
                                </Button>
                            </Tooltip>
                        </>
                    }
                    tableProps={{
                        size: "small",
                        bordered: true,
                        tableLayout: "fixed",
                        loading: isLoading || isMutating,
                        locale: {
                            emptyText:
                                connections.length === 0 ? (
                                    <EmptyState
                                        className="py-6"
                                        image="simple"
                                        description={
                                            <div className="flex flex-col gap-1">
                                                <span className="text-base font-semibold text-colorText">
                                                    Connect an app first
                                                </span>
                                                <span>
                                                    Connect an app, then subscribe a workflow to its
                                                    events.
                                                </span>
                                            </div>
                                        }
                                    />
                                ) : (
                                    <EmptyState
                                        className="py-6"
                                        image="simple"
                                        description={
                                            <div className="flex flex-col gap-1">
                                                <span className="text-base font-semibold text-colorText">
                                                    No event triggers yet
                                                </span>
                                                <span>
                                                    Run a workflow whenever an event fires in a
                                                    connected app.
                                                </span>
                                            </div>
                                        }
                                    >
                                        <Button icon={<Plus size={14} />} onClick={handleCreate}>
                                            Subscribe
                                        </Button>
                                    </EmptyState>
                                ),
                        },
                        onRow: (record: SubscriptionRow) => ({
                            onClick: () => handleEdit(record),
                            className: "cursor-pointer",
                        }),
                    }}
                />
            </section>

            <TriggerSubscriptionDrawer />
        </>
    )
}
