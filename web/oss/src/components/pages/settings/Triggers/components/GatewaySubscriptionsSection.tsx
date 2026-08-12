import {useCallback, useMemo, useState} from "react"

import {
    isEntityActive,
    isEntityValid,
    triggerBoundAgentId,
    triggerDeliveriesDrawerAtom,
    triggerSubscriptionDrawerAtom,
    useTriggerConnectionsQuery,
    useTriggerSubscription,
    useTriggerSubscriptions,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {TriggerSubscriptionDrawer} from "@agenta/entity-ui/gatewayTrigger"
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
    Pause,
    PencilSimpleLine,
    Play,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {Button, message, Tag, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"

import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

import {useAgentNameById} from "./useAgentNameById"

export default function GatewaySubscriptionsSection() {
    const {subscriptions, isLoading, refetch} = useTriggerSubscriptions()
    const {connections} = useTriggerConnectionsQuery()
    const {revoke, refresh, remove, setActive, isMutating} = useTriggerSubscription()
    const openDrawer = useSetAtom(triggerSubscriptionDrawerAtom)
    const openDeliveries = useSetAtom(triggerDeliveriesDrawerAtom)
    const [reloading, setReloading] = useState(false)

    const agentNameById = useAgentNameById()

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
                    fixed: "left",
                    render: (_value, record) => {
                        const label = record.name || record.id || "-"
                        // Fixed-width column: truncate rather than wrap, full name on hover.
                        return (
                            <Typography.Text ellipsis={{tooltip: label}}>{label}</Typography.Text>
                        )
                    },
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
                    key: "workflow",
                    title: "Connected agent",
                    width: 180,
                    render: (_value, record) => {
                        const wfId = triggerBoundAgentId(record.data?.references)
                        const name = wfId ? agentNameById.get(wfId) : undefined
                        // A raw id says nothing to a reader, so an unresolved name shows "-".
                        if (!name) return <Typography.Text type="secondary">-</Typography.Text>
                        return (
                            <Typography.Text className="text-xs" ellipsis={{tooltip: name}}>
                                {name}
                            </Typography.Text>
                        )
                    },
                },
                {
                    type: "text",
                    key: "event",
                    title: "Event",
                    width: 220,
                    render: (_value, record) => {
                        const key = record.data?.event_key
                        if (!key) return <Typography.Text type="secondary">-</Typography.Text>
                        // Event keys are long enough to overflow the column; keep them one line.
                        return (
                            <Tooltip title={key}>
                                <Tag
                                    bordered={false}
                                    color="default"
                                    className="inline-block max-w-full truncate bg-[var(--ag-c-0517290F)] px-2 py-[1px] align-middle"
                                >
                                    {key}
                                </Tag>
                            </Tooltip>
                        )
                    },
                },
                {
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 130,
                    // Reads as a state, like the Connections table; pausing lives in the
                    // row menu so the column stays scannable.
                    render: (_value, record) =>
                        !isEntityValid(record) ? (
                            <StatusIndicator tone="error" label="Invalid" />
                        ) : isEntityActive(record) ? (
                            <StatusIndicator tone="success" label="Active" />
                        ) : (
                            <StatusIndicator tone="default" label="Paused" />
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
                                        mode: "owner-history",
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
                            key: "pause",
                            label: "Pause",
                            icon: <Pause size={16} />,
                            hidden: (record: SubscriptionRow) => !isEntityActive(record),
                            onClick: (record: SubscriptionRow) => handleToggle(record)(false),
                        },
                        {
                            key: "resume",
                            label: "Resume",
                            icon: <Play size={16} />,
                            hidden: (record: SubscriptionRow) => isEntityActive(record),
                            onClick: (record: SubscriptionRow) => handleToggle(record)(true),
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
            agentNameById,
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
        {loading: isLoading || isMutating},
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
                            <p className="m-0 font-medium text-colorText">Event triggers</p>
                            <p className="m-0 font-normal text-colorTextSecondary">
                                Run a workflow whenever a connected app sends an event.
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
                                    disabled={isLoading || isMutating || connections.length === 0}
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
                        locale: {
                            emptyText:
                                connections.length === 0 ? (
                                    <EmptyState
                                        image="simple"
                                        description={
                                            <div className="flex flex-col gap-1">
                                                <span className="text-xs font-medium text-colorText">
                                                    Connect an app first
                                                </span>
                                                <span>
                                                    Connect an app, then subscribe an agent to its
                                                    events.
                                                </span>
                                            </div>
                                        }
                                    />
                                ) : (
                                    <EmptyState
                                        image="simple"
                                        description={
                                            <div className="flex flex-col gap-1">
                                                <span className="text-xs font-medium text-colorText">
                                                    No event triggers yet
                                                </span>
                                                <span>
                                                    Run an agent whenever a connected app sends an
                                                    event.
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
