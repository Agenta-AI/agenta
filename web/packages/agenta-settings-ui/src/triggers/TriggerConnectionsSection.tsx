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
import {formatDay} from "@agenta/shared/utils/dateTime"
import {message} from "@agenta/ui/app-message"
import {Tag} from "@agenta/ui/components/presentational"
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
import {ArrowClockwise, Lightning, Plus, Trash, XCircle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

const DEFAULT_PROVIDER = "composio"

export interface TriggerConnectionsSectionProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: (args: {title: string; message: string; onOk: () => Promise<void>}) => void
}

export default function TriggerConnectionsSection({confirm}: TriggerConnectionsSectionProps) {
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
            confirm?.({
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
        [confirm, handleRevoke],
    )

    const confirmDelete = useCallback(
        (connection: TriggerConnection) => {
            confirm?.({
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
        [confirm, handleDelete],
    )

    interface ConnectionRow extends TriggerConnection {
        key: string
        [extra: string]: unknown
    }

    const rows = useMemo<ConnectionRow[]>(
        () =>
            (connections ?? []).map((connection, index) => ({
                ...connection,
                key:
                    connection.id ??
                    connection.slug ??
                    connection.integration_key ??
                    `connection-${index}`,
            })),
        [connections],
    )

    const columns = useMemo<DataTableColumn<ConnectionRow>[]>(
        () => [
            {
                key: "integration_key",
                title: "App",
                width: 180,
                render: (record) => <Tag>{record.integration_key}</Tag>,
            },
            {
                key: "name",
                title: "Name",
                width: 200,
                render: (record) => record.name || record.slug,
            },
            {key: "slug", title: "Slug", width: 250, mono: true, render: (r) => r.slug},
            {
                key: "status",
                title: "Status",
                width: 150,
                render: (record) => <ConnectionStatusBadge connection={record} />,
            },
            {
                key: "created_at",
                title: "Connected",
                width: 160,
                render: (record) =>
                    record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
        ],
        [],
    )

    return (
        <>
            <section className="flex flex-col">
                <DataTable<ConnectionRow>
                    // Keeps connection slugs out of PostHog session recordings.
                    className="ph-no-capture"
                    rows={rows}
                    loading={isLoading}
                    onRowClick={openEvents}
                    actions={(record) => [
                        {
                            key: "events",
                            label: "Browse events",
                            icon: <Lightning size={16} />,
                            onClick: () => openEvents(record),
                        },
                        {
                            key: "refresh",
                            label: "Refresh",
                            icon: <ArrowClockwise size={16} />,
                            onClick: () => onRefresh(record),
                        },
                        {
                            key: "revoke",
                            label: "Revoke",
                            icon: <XCircle size={16} />,
                            hidden: !confirm,
                            onClick: () => confirmRevoke(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            hidden: !confirm,
                            onClick: () => confirmDelete(record),
                        },
                    ]}
                    title={
                        <div className="flex flex-col gap-1">
                            <p className="m-0 font-medium text-colorText">Connections</p>
                            <p className="m-0 font-normal text-colorTextSecondary">
                                Link an app like GitHub or Slack so its events can trigger your
                                workflows.
                            </p>
                        </div>
                    }
                    columns={columns}
                    rowKey={(record) => record.key}
                    primaryActions={
                        <>
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            aria-label="Reload all connections"
                                            disabled={reloading}
                                            onClick={reloadAll}
                                        >
                                            <ArrowClockwise size={14} />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Reload all connections</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                            <Button disabled={isLoading} onClick={() => setCatalogOpen(true)}>
                                <Plus size={14} />
                                Connect app
                            </Button>
                        </>
                    }
                    empty={
                        <EmptyState
                            image="simple"
                            description={
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-medium text-colorText">
                                        No connections yet
                                    </span>
                                    <span>
                                        Connect an app like GitHub or Slack to start receiving its
                                        events.
                                    </span>
                                </div>
                            }
                        >
                            <Button variant="outline" onClick={() => setCatalogOpen(true)}>
                                <Plus size={14} />
                                Connect app
                            </Button>
                        </EmptyState>
                    }
                />
            </section>

            <TriggerCatalogDrawer onConnectionCreated={refetch} />
            <TriggerEventsDrawer />
        </>
    )
}
