import {useCallback, useMemo, useState} from "react"

import {
    fetchToolConnection,
    toolCatalogDrawerOpenAtom,
    toolExecutionDrawerAtom,
    useToolConnectionActions,
    useToolConnectionsQuery,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {
    CatalogDrawer,
    ConnectionStatusBadge,
    ToolExecutionDrawer,
} from "@agenta/entity-ui/gatewayTool"
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
import {ArrowClockwise, DotsThree, GearSix, Play, Plus, Trash, XCircle} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import ConfirmDialog, {type ConfirmRequest} from "@/oss/components/ConfirmDialog"
import {getAgentaApiUrl, getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

const AUTH_SCHEME_LABELS: Record<string, string> = {
    oauth: "OAuth",
    api_key: "API Key",
}

export default function GatewayToolsSection() {
    const {connections, isLoading, refetch} = useToolConnectionsQuery()
    const {handleDelete, handleRefresh, handleRevoke, invalidateConnections} =
        useToolConnectionActions()
    const setCatalogOpen = useSetAtom(toolCatalogDrawerOpenAtom)
    const setExecutionDrawer = useSetAtom(toolExecutionDrawerAtom)
    const [reloading, setReloading] = useState(false)
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

    const reloadAll = useCallback(async () => {
        setReloading(true)
        try {
            // Poll each connection individually to trigger Composio status sync
            await Promise.allSettled(
                connections
                    .map((c) => c.id)
                    .filter((id): id is string => typeof id === "string")
                    .map((id) => fetchToolConnection(id)),
            )
            invalidateConnections()
        } finally {
            setReloading(false)
        }
    }, [connections, invalidateConnections])

    const openExecution = useCallback(
        (record: ToolConnection) => {
            if (!record.id || !record.slug) return
            setExecutionDrawer({
                connectionId: record.id,
                connectionSlug: record.slug,
                integrationKey: record.integration_key,
            })
        },
        [setExecutionDrawer],
    )

    const onRefresh = useCallback(
        async (connection: ToolConnection) => {
            if (!connection.id) return
            const connectionId = connection.id
            try {
                const result = await handleRefresh(connectionId)

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
                            await fetchToolConnection(connectionId)
                        } catch {
                            /* best-effort */
                        }
                        invalidateConnections()
                        toast.success("Connection refreshed")
                    }

                    const trustedOrigins = new Set<string>([window.location.origin])
                    for (const url of [getAgentaApiUrl(), getAgentaWebUrl()]) {
                        if (!url) continue
                        try {
                            trustedOrigins.add(new URL(url).origin)
                        } catch {
                            // ignore invalid env URLs
                        }
                    }

                    const handler = (event: MessageEvent) => {
                        if (
                            event.data?.type === "tools:oauth:complete" &&
                            trustedOrigins.has(event.origin)
                        ) {
                            window.removeEventListener("message", handler)
                            void cleanup()
                        }
                    }
                    window.addEventListener("message", handler)

                    // Fallback: detect popup closed
                    const pollTimer = setInterval(() => {
                        if (popup && popup.closed) {
                            clearInterval(pollTimer)
                            window.removeEventListener("message", handler)
                            void cleanup()
                        }
                    }, 1000)
                } else {
                    toast.success("Connection refreshed")
                }
            } catch {
                toast.error("Failed to refresh connection")
            }
        },
        [handleRefresh, invalidateConnections],
    )

    const confirmDelete = useCallback(
        (connection: ToolConnection) => {
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

    const confirmRevoke = useCallback(
        (connection: ToolConnection) => {
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

    const columns: ColumnDef<ToolConnection, unknown>[] = useMemo(
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
                id: "auth_scheme",
                header: "Auth",
                minSize: 100,
                enableSorting: false,
                cell: ({row}) => {
                    const scheme =
                        typeof row.original.data?.auth_scheme === "string"
                            ? row.original.data.auth_scheme
                            : undefined
                    if (!scheme) return <span className="text-muted-foreground">—</span>
                    return <Badge variant="outline">{AUTH_SCHEME_LABELS[scheme] ?? scheme}</Badge>
                },
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
                                    disabled={!(record.flags?.is_active && record.flags?.is_valid)}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        openExecution(record)
                                    }}
                                >
                                    <Play size={16} />
                                    Test
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
        [confirmDelete, confirmRevoke, onRefresh, openExecution],
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
                    <DataTable<ToolConnection>
                        columns={columns}
                        data={connections}
                        getRowId={(record) => record.id ?? record.slug ?? ""}
                        loading={isLoading}
                        enableSorting={false}
                        onRowClick={(row) => openExecution(row.original)}
                    />
                </div>
            </section>

            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />

            {/* Drawers */}
            <CatalogDrawer onConnectionCreated={refetch} />
            <ToolExecutionDrawer />
        </>
    )
}
