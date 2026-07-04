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
import {ConfirmDialog, type ConfirmRequest} from "@agenta/ui/components/modal"
import {
    ArrowClockwise,
    DotsThree,
    GearSix,
    Lightning,
    Plus,
    Trash,
    XCircle,
} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

const DEFAULT_PROVIDER = "composio"

export default function GatewayTriggersSection() {
    const {connections, isLoading, refetch} = useTriggerConnectionsQuery()
    const {handleDelete, handleRefresh, handleRevoke, invalidateConnections} =
        useTriggerConnectionActions()
    const setEventsDrawer = useSetAtom(triggerEventsDrawerAtom)
    const setCatalogOpen = useSetAtom(triggerCatalogDrawerOpenAtom)
    const [reloading, setReloading] = useState(false)
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

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
                toast.success("Connection refreshed")
            } catch {
                toast.error("Failed to refresh connection")
            }
        },
        [handleRefresh],
    )

    const confirmRevoke = useCallback(
        (connection: TriggerConnection) => {
            setConfirm({
                title: "Revoke Connection",
                message:
                    "This will mark the connection as invalid. You can refresh it later to reactivate.",
                onOk: async () => {
                    if (!connection.id) return
                    try {
                        await handleRevoke(connection.id)
                        toast.success("Connection revoked")
                    } catch {
                        toast.error("Failed to revoke connection")
                    }
                },
            })
        },
        [handleRevoke],
    )

    const confirmDelete = useCallback(
        (connection: TriggerConnection) => {
            setConfirm({
                title: "Delete Connection",
                message:
                    "Are you sure you want to delete this connection? This action is irreversible.",
                danger: true,
                okText: "Delete",
                onOk: async () => {
                    if (!connection.id) return
                    try {
                        await handleDelete(connection.id)
                        toast.success("Connection deleted")
                    } catch {
                        toast.error("Failed to delete connection")
                    }
                },
            })
        },
        [handleDelete],
    )

    const columns: ColumnDef<TriggerConnection, unknown>[] = useMemo(
        () => [
            {
                id: "integration",
                header: "Integration",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => <Badge variant="secondary">{row.original.integration_key}</Badge>,
            },
            {
                id: "name",
                header: "Name",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => <span>{row.original.name || row.original.slug}</span>,
            },
            {
                id: "slug",
                accessorKey: "slug",
                header: "Slug",
                minSize: 160,
                enableSorting: false,
                cell: ({row}) => <span>{row.original.slug}</span>,
            },
            {
                id: "status",
                header: "Status",
                minSize: 120,
                enableSorting: false,
                cell: ({row}) => <ConnectionStatusBadge connection={row.original} />,
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
                size: 48,
                enableSorting: false,
                cell: ({row}) => {
                    const record = row.original
                    return (
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                render={
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Open connection actions"
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
                                        openEvents(record)
                                    }}
                                >
                                    <Lightning size={16} />
                                    Browse events
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onRefresh(record)
                                    }}
                                >
                                    <ArrowClockwise size={16} />
                                    Refresh
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    disabled={!record.flags?.is_valid}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        confirmRevoke(record)
                                    }}
                                >
                                    <XCircle size={16} />
                                    Revoke
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    variant="destructive"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        confirmDelete(record)
                                    }}
                                >
                                    <Trash size={16} />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )
                },
            },
        ],
        [openEvents, onRefresh, confirmRevoke, confirmDelete],
    )

    return (
        <>
            <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => setCatalogOpen(true)}>
                        <Plus size={14} />
                        Connect
                    </Button>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Reload all connections"
                                    disabled={reloading}
                                    onClick={reloadAll}
                                >
                                    {reloading ? <Spinner /> : <ArrowClockwise size={14} />}
                                </Button>
                            }
                        />
                        <TooltipContent>Reload all connections</TooltipContent>
                    </Tooltip>
                </div>

                <div className="ph-no-capture">
                    <DataTable<TriggerConnection>
                        columns={columns}
                        data={connections}
                        getRowId={(record) => record.id ?? record.slug ?? record.integration_key}
                        loading={isLoading}
                        enableSorting={false}
                        onRowClick={(row) => openEvents(row.original)}
                    />
                </div>
            </section>

            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
            <TriggerCatalogDrawer onConnectionCreated={refetch} />
            <TriggerEventsDrawer />
        </>
    )
}
