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
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {toast} from "@agenta/primitive-ui/lib/toast"
import {
    ArrowClockwise,
    ArrowsClockwise,
    DotsThree,
    GearSix,
    ListChecks,
    PencilSimpleLine,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
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
                toast.success("Subscription revoked")
            } catch {
                toast.error("Failed to revoke subscription")
            }
        },
        [revoke],
    )

    const handleRefresh = useCallback(
        async (record: TriggerSubscription) => {
            if (!record.id) return
            try {
                await refresh(record.id)
                toast.success("Subscription refreshed")
            } catch {
                toast.error("Failed to refresh subscription")
            }
        },
        [refresh],
    )

    const handleDelete = useCallback(
        async (record: TriggerSubscription) => {
            if (!record.id) return
            try {
                await remove(record.id)
                toast.success("Subscription deleted")
            } catch {
                toast.error("Failed to delete subscription")
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

    const columns: ColumnDef<TriggerSubscription, unknown>[] = useMemo(
        () => [
            {
                id: "name",
                header: "Name",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => <span>{row.original.name || row.original.id || "-"}</span>,
            },
            {
                id: "connection",
                header: "Connection",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => <span>{connectionLabel(row.original.connection_id)}</span>,
            },
            {
                id: "event",
                header: "Event",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => (
                    <Badge variant="secondary">{row.original.data?.event_key ?? "-"}</Badge>
                ),
            },
            {
                id: "status",
                header: "Status",
                minSize: 120,
                enableSorting: false,
                // WP1: top-level `enabled`/`valid` are gone; read flags.
                cell: ({row}) =>
                    !isEntityValid(row.original) ? (
                        <Badge variant="destructive">Invalid</Badge>
                    ) : isEntityActive(row.original) ? (
                        <Badge>Active</Badge>
                    ) : (
                        <Badge variant="secondary">Paused</Badge>
                    ),
            },
            {
                id: "created_at",
                accessorKey: "created_at",
                header: "Created at",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) =>
                    row.original.created_at
                        ? formatDay({
                              date: row.original.created_at,
                              outputFormat: "YYYY-MM-DD HH:mm",
                          })
                        : "-",
            },
            {
                id: "actions",
                header: () => <GearSix size={16} className="mx-auto" />,
                size: 96,
                enableSorting: false,
                cell: ({row}) => {
                    const record = row.original
                    return (
                        <div className="flex items-center justify-center gap-1">
                            <ActiveToggle
                                active={isEntityActive(record)}
                                onToggle={handleToggle(record)}
                                disabled={!record.id || !isEntityValid(record)}
                                activatedMessage="Subscription resumed"
                                pausedMessage="Subscription paused"
                                errorMessage="Failed to update subscription"
                            />
                            <DropdownMenu>
                                <DropdownMenuTrigger
                                    render={
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Open subscription actions"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <DotsThree size={16} />
                                        </Button>
                                    }
                                />
                                <DropdownMenuContent className="w-[180px]" align="end">
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            if (record.id)
                                                openDeliveries({
                                                    owner: {kind: "subscription", id: record.id},
                                                    name: record.name ?? undefined,
                                                })
                                        }}
                                    >
                                        <ListChecks size={16} />
                                        View deliveries
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleEdit(record)
                                        }}
                                    >
                                        <PencilSimpleLine size={16} />
                                        Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleRefresh(record)
                                        }}
                                    >
                                        <ArrowsClockwise size={16} />
                                        Refresh
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleRevoke(record)
                                        }}
                                    >
                                        <XCircle size={16} />
                                        Revoke
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleDelete(record)
                                        }}
                                    >
                                        <Trash size={16} />
                                        Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )
                },
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
                    <Button size="sm" onClick={handleCreate} disabled={connections.length === 0}>
                        <Plus size={14} />
                        Subscribe
                    </Button>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Reload all subscriptions"
                                    disabled={reloading}
                                    onClick={reloadAll}
                                >
                                    {reloading ? <Spinner /> : <ArrowClockwise size={14} />}
                                </Button>
                            }
                        />
                        <TooltipContent>Reload all subscriptions</TooltipContent>
                    </Tooltip>
                </div>

                <div className="ph-no-capture">
                    <DataTable<TriggerSubscription>
                        columns={columns}
                        data={subscriptions}
                        getRowId={(record) =>
                            record.id ?? record.slug ?? record.data?.event_key ?? ""
                        }
                        loading={isLoading || isMutating}
                        enableSorting={false}
                        onRowClick={(row) => handleEdit(row.original)}
                    />
                </div>
            </section>

            <TriggerSubscriptionDrawer />
        </>
    )
}
