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
import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {ArrowClockwise, Lightning, Plus, Trash, XCircle} from "@phosphor-icons/react"
import {Button, message, Tag, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"

import AlertPopup from "@/oss/components/AlertPopup/AlertPopup"
import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

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

    const columns = useMemo(
        () =>
            createStandardColumns<ConnectionRow>([
                {
                    type: "text",
                    key: "integration_key",
                    title: "App",
                    width: 180,
                    fixed: "left",
                    render: (_value, record) => (
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
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 200,
                    render: (_value, record) => (
                        <Typography.Text>{record.name || record.slug}</Typography.Text>
                    ),
                },
                {type: "slug", key: "slug", title: "Slug", width: 250},
                {
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 150,
                    render: (_value, record) => <ConnectionStatusBadge connection={record} />,
                },
                {
                    type: "text",
                    key: "created_at",
                    title: "Connected",
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
                            key: "events",
                            label: "Browse events",
                            icon: <Lightning size={16} />,
                            onClick: (record: ConnectionRow) => openEvents(record),
                        },
                        {
                            key: "refresh",
                            label: "Refresh",
                            icon: <ArrowClockwise size={16} />,
                            onClick: (record: ConnectionRow) => onRefresh(record),
                        },
                        {
                            key: "revoke",
                            label: "Revoke",
                            icon: <XCircle size={16} />,
                            onClick: (record: ConnectionRow) => confirmRevoke(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record: ConnectionRow) => confirmDelete(record),
                        },
                    ],
                } satisfies StandardColumnDef<ConnectionRow>,
            ]),
        [openEvents, onRefresh, confirmRevoke, confirmDelete],
    )

    const {tableScope, pagination} = useStaticTable<ConnectionRow>(
        "settings-trigger-connections",
        rows,
        {loading: isLoading},
    )
    return (
        <>
            <section className="flex flex-col">
                <InfiniteVirtualTableFeatureShell<ConnectionRow>
                    // Keeps connection slugs out of PostHog session recordings.
                    className="ph-no-capture"
                    tableScope={tableScope}
                    autoHeight={false}
                    emptyMinHeight={250}
                    title={
                        <div className="flex flex-col gap-1">
                            <h3 className="m-0 font-medium text-colorText">Connections</h3>
                            <p className="m-0 font-normal text-colorTextSecondary">
                                Link an app like GitHub or Slack so its events can trigger your
                                workflows.
                            </p>
                        </div>
                    }
                    columns={columns}
                    rowKey={(record) => record.key}
                    pagination={pagination}
                    primaryActions={
                        <>
                            <Tooltip title="Reload all connections">
                                <Button
                                    icon={<ArrowClockwise size={14} />}
                                    type="default"
                                    aria-label="Reload all connections"
                                    loading={reloading}
                                    onClick={reloadAll}
                                />
                            </Tooltip>
                            <Button
                                icon={<Plus size={14} />}
                                type="primary"
                                disabled={isLoading}
                                onClick={() => setCatalogOpen(true)}
                            >
                                Connect app
                            </Button>
                        </>
                    }
                    tableProps={{
                        size: "small",
                        bordered: true,
                        tableLayout: "fixed",
                        locale: {
                            emptyText: (
                                <EmptyState
                                    image="simple"
                                    description={
                                        <div className="flex flex-col gap-1">
                                            <span className="text-sm font-medium text-colorText">
                                                No connections yet
                                            </span>
                                            <span>
                                                Connect an app like GitHub or Slack to start
                                                receiving its events.
                                            </span>
                                        </div>
                                    }
                                >
                                    <Button
                                        icon={<Plus size={14} />}
                                        onClick={() => setCatalogOpen(true)}
                                    >
                                        Connect app
                                    </Button>
                                </EmptyState>
                            ),
                        },
                        onRow: (record: ConnectionRow) => ({
                            onClick: () => openEvents(record),
                            className: "cursor-pointer",
                        }),
                    }}
                />
            </section>

            <TriggerCatalogDrawer onConnectionCreated={refetch} />
            <TriggerEventsDrawer />
        </>
    )
}
