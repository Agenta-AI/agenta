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
import {formatDay} from "@agenta/shared/utils/dateTime"
import {message} from "@agenta/ui/app-message"
import {StatusIndicator, Tag} from "@agenta/ui/components/presentational"
import {
    Button,
    DataTable,
    EmptyState,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
    type DataTableColumn,
} from "@agenta/ui/ui"
import {
    ArrowsClockwise,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import type {DestructiveConfirmProps} from "../confirm"

export interface TriggerSubscriptionsSectionProps extends DestructiveConfirmProps {
    /** Hides create/edit and skips the drawer, whose form is still antd-backed. */
    readOnly?: boolean
}

export default function TriggerSubscriptionsSection({
    confirm,
    readOnly,
}: TriggerSubscriptionsSectionProps = {}) {
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

    // Revoke and delete both ask first, through the host `confirm` seam the connection sections
    // already use. Without a host confirm they stay inert rather than firing silently.
    const handleRevoke = useCallback(
        (record: TriggerSubscription) => {
            if (!record.id) return
            confirm?.({
                title: "Revoke subscription",
                message: "This stops deliveries to this subscription. You can re-create it later.",
                onOk: async () => {
                    try {
                        await revoke(record.id as string)
                        message.success("Subscription revoked")
                    } catch {
                        message.error("Failed to revoke subscription")
                    }
                },
            })
        },
        [confirm, revoke],
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
        (record: TriggerSubscription) => {
            if (!record.id) return
            confirm?.({
                title: "Delete subscription",
                message:
                    "Are you sure you want to delete this subscription? This action is irreversible.",
                onOk: async () => {
                    try {
                        await remove(record.id as string)
                        message.success("Subscription deleted")
                    } catch {
                        message.error("Failed to delete subscription")
                    }
                },
            })
        },
        [confirm, remove],
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

    const columns = useMemo<DataTableColumn<SubscriptionRow>[]>(
        () => [
            {
                key: "name",
                title: "Name",
                width: 200,
                render: (record) => <span>{record.name || record.id || "-"}</span>,
            },
            {
                key: "connection",
                title: "Connection",
                width: 200,
                render: (record) => connectionLabel(record.connection_id),
            },
            {
                key: "event",
                title: "Event",
                width: 220,
                render: (record) => <Tag>{record.data?.event_key ?? "-"}</Tag>,
            },
            {
                // The toggle shows the state and changes it, so it lives in Status.
                key: "status",
                title: "Status",
                width: 140,
                render: (record) =>
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
                key: "created_at",
                title: "Created",
                width: 160,
                render: (record) =>
                    record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
        ],
        [connectionLabel, handleToggle],
    )
    return (
        <>
            <section className="flex flex-col">
                <DataTable<SubscriptionRow>
                    className="ph-no-capture"
                    rows={rows}
                    loading={isLoading || isMutating}
                    onRowClick={readOnly ? undefined : handleEdit}
                    actions={(record) => [
                        {
                            key: "deliveries",
                            label: "View deliveries",
                            icon: <ListChecks size={16} />,
                            onClick: () => {
                                if (record.id)
                                    openDeliveries({
                                        owner: {kind: "subscription", id: record.id},
                                        name: record.name ?? undefined,
                                    })
                            },
                        },
                        {
                            key: "edit",
                            hidden: readOnly,
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: () => handleEdit(record),
                        },
                        {
                            key: "refresh",
                            hidden: readOnly,
                            label: "Refresh",
                            icon: <ArrowsClockwise size={16} />,
                            onClick: () => handleRefresh(record),
                        },
                        {
                            key: "revoke",
                            hidden: readOnly,
                            label: "Revoke",
                            icon: <XCircle size={16} />,
                            onClick: () => handleRevoke(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            hidden: readOnly,
                            onClick: () => handleDelete(record),
                        },
                    ]}
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
                    onReload={reloadAll}
                    reloading={reloading}
                    reloadLabel="Reload all event triggers"
                    primaryActions={
                        <>
                            <TooltipProvider>
                                {/* Subscribing needs a connected app, so say so on the disabled
                                    button rather than leaving it inert and unexplained. */}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span className={readOnly ? "hidden" : undefined}>
                                            <Button
                                                onClick={handleCreate}
                                                disabled={
                                                    isLoading ||
                                                    isMutating ||
                                                    connections.length === 0
                                                }
                                            >
                                                <Plus size={14} />
                                                Subscribe
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    {connections.length === 0 ? (
                                        <TooltipContent>Connect an app first</TooltipContent>
                                    ) : null}
                                </Tooltip>
                            </TooltipProvider>
                        </>
                    }
                    empty={
                        connections.length === 0 ? (
                            <EmptyState
                                image="simple"
                                description={
                                    <div className="flex flex-col gap-1">
                                        <span className="text-xs font-medium text-colorText">
                                            Connect an app first
                                        </span>
                                        <span>
                                            Connect an app, then subscribe an agent to its events.
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
                                            Run an agent whenever a connected app sends an event.
                                        </span>
                                    </div>
                                }
                            >
                                {readOnly ? null : (
                                    <Button variant="outline" onClick={handleCreate}>
                                        <Plus size={14} />
                                        Subscribe
                                    </Button>
                                )}
                            </EmptyState>
                        )
                    }
                />
            </section>

            {readOnly ? null : <TriggerSubscriptionDrawer />}
        </>
    )
}
