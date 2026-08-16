import {useMemo} from "react"

import type {ToolConnection} from "@agenta/entities/gatewayTool"
import {ConnectionStatusBadge} from "@agenta/entity-ui/gatewayTool"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {Tag} from "@agenta/ui/components/presentational"
import {DataTable, type DataTableColumn} from "@agenta/ui/ui"
import {ArrowClockwise, Trash} from "@phosphor-icons/react"

import {useToolsConnections} from "./hooks/useToolsConnections"

interface Props {
    integrationKey: string
    connections: ToolConnection[]
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: (args: {title: string; message: string; onOk: () => void | Promise<void>}) => void
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

export default function ConnectionsList({integrationKey, connections, confirm}: Props) {
    const {handleDelete, handleRefresh, invalidate} = useToolsConnections(integrationKey)

    const confirmDelete = (connection: ToolConnection) => {
        if (!connection.id) return
        confirm?.({
            title: "Delete Connection",
            message:
                "Are you sure you want to delete this connection? This action is irreversible.",
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

    const columns = useMemo<DataTableColumn<ToolConnection>[]>(
        () => [
            {key: "slug", title: "Name", render: (record) => record.name || record.slug},
            {
                key: "status",
                title: "Status",
                width: 120,
                render: (record) => <ConnectionStatusBadge connection={record} />,
            },
            {
                key: "auth_scheme",
                title: "Auth",
                width: 100,
                render: (record) => {
                    const scheme =
                        typeof record.data?.auth_scheme === "string"
                            ? record.data.auth_scheme
                            : undefined
                    if (!scheme) return <span className="text-colorTextSecondary">—</span>
                    return <Tag>{AUTH_SCHEME_LABELS[scheme] ?? scheme}</Tag>
                },
            },
            {
                key: "created_at",
                title: "Created",
                width: 180,
                render: (record) =>
                    record.created_at
                        ? formatDay({date: record.created_at, outputFormat: "YYYY-MM-DD HH:mm"})
                        : "-",
            },
        ],
        [],
    )

    return (
        <DataTable<ToolConnection>
            columns={columns}
            rows={connections}
            rowKey={(record) => record.slug ?? record.id ?? ""}
            actions={(record) => [
                {
                    key: "refresh",
                    label: "Refresh",
                    icon: <ArrowClockwise size={16} />,
                    disabled: !record.id,
                    onClick: () => void onRefresh(record),
                },
                {
                    key: "delete",
                    label: "Delete",
                    icon: <Trash size={16} />,
                    danger: true,
                    hidden: !confirm,
                    disabled: !record.id,
                    onClick: () => confirmDelete(record),
                },
            ]}
            empty={<span className="text-colorTextSecondary">No connections yet</span>}
        />
    )
}
