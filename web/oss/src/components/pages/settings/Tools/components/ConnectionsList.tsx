import {useMemo, useState} from "react"

import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {ConnectionStatusBadge} from "@agenta/entity-ui/gatewayTool"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {type ColumnDef, DataTable} from "@agenta/primitive-ui/components/data-table"
import {Tooltip, TooltipContent, TooltipTrigger} from "@agenta/primitive-ui/components/tooltip"
import {ArrowClockwise, GearSix, Trash} from "@phosphor-icons/react"

import ConfirmDialog, {type ConfirmRequest} from "@/oss/components/ConfirmDialog"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

import {useToolsConnections} from "../hooks/useToolsConnections"

interface Props {
    integrationKey: string
    connections: ToolConnection[]
}

const getRedirectUrl = (connection: ToolConnection | null | undefined): string | undefined => {
    if (!connection) return undefined
    const dataRedirect = connection.data?.redirect_url
    return typeof dataRedirect === "string" && dataRedirect ? dataRedirect : undefined
}

const AUTH_SCHEME_LABELS: Record<string, string> = {
    oauth: "OAuth",
    api_key: "API Key",
}

export default function ConnectionsList({integrationKey, connections}: Props) {
    const {handleDelete, handleRefresh, invalidate} = useToolsConnections(integrationKey)
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

    const confirmDelete = (connection: ToolConnection) => {
        if (!connection.id) return
        setConfirm({
            title: "Delete Connection",
            message:
                "Are you sure you want to delete this connection? This action is irreversible.",
            danger: true,
            okText: "Delete",
            onOk: () => handleDelete(connection.id as string),
        })
    }

    const onRefresh = async (connection: ToolConnection) => {
        if (!connection.id) return

        const result = await handleRefresh(connection.id)
        const redirectUrl = getRedirectUrl(result.connection)

        if (!redirectUrl) return

        const popup = window.open(
            redirectUrl,
            "tools_oauth_refresh",
            "width=600,height=700,popup=yes",
        )

        if (!popup) return

        const pollTimer = setInterval(() => {
            if (popup.closed) {
                clearInterval(pollTimer)
                window.focus()
                invalidate()
            }
        }, 1000)
    }

    const columns: ColumnDef<ToolConnection, unknown>[] = useMemo(
        () => [
            {
                id: "slug",
                accessorKey: "slug",
                header: "Name",
                enableSorting: false,
                cell: ({row}) => <span>{row.original.name || row.original.slug}</span>,
            },
            {
                id: "status",
                header: "Status",
                size: 120,
                enableSorting: false,
                cell: ({row}) => <ConnectionStatusBadge connection={row.original} />,
            },
            {
                id: "auth_scheme",
                header: "Auth",
                size: 100,
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
                header: "Created",
                size: 180,
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
                size: 80,
                enableSorting: false,
                cell: ({row}) => {
                    const record = row.original
                    return (
                        <div className="flex items-center gap-1">
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Refresh connection"
                                            onClick={() => void onRefresh(record)}
                                            disabled={!record.id}
                                        >
                                            <ArrowClockwise size={14} />
                                        </Button>
                                    }
                                />
                                <TooltipContent>Refresh</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label="Delete connection"
                                            onClick={() => confirmDelete(record)}
                                            disabled={!record.id}
                                        >
                                            <Trash size={14} className="text-destructive" />
                                        </Button>
                                    }
                                />
                                <TooltipContent>Delete</TooltipContent>
                            </Tooltip>
                        </div>
                    )
                },
            },
        ],
        [handleDelete, handleRefresh],
    )

    return (
        <>
            <DataTable<ToolConnection>
                columns={columns}
                data={connections}
                getRowId={(record) => record.slug ?? record.id ?? ""}
                enableSorting={false}
                emptyText="No connections yet"
            />
            <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
        </>
    )
}
