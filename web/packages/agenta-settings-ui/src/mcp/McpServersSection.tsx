/**
 * The project's MCP connections, as one settings section both hosts mount.
 *
 * It lives here rather than in `web/oss` so the desktop and the mobile app render the same
 * surface from the same code. That is the whole reason the integrations section next door
 * takes a copy override, and this follows it.
 *
 * The list shows stored connections only. Provider-managed rows belong with the
 * integrations they come from, not under a heading about MCP servers.
 */
import {useCallback, useMemo, useState} from "react"

import {
    disconnectMcpEndpointAtom,
    deleteMcpEndpointAtom,
    getMcpConnectionState,
    getMcpConnectionStateLabel,
    mcpEndpointsQueryAtom,
    refreshMcpEndpointsAtom,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {McpConnectJourney, McpConnectionDetail} from "@agenta/entity-ui/mcpEndpoint"
import {message} from "@agenta/ui/app-message"
import {Tag} from "@agenta/ui/components/presentational"
import {Button, DataTable, EmptyState, type DataTableColumn} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import type {ConfirmDestructive} from "../confirm"

/** Nouns for the rows; a host that calls them something else passes its own. */
export interface McpServersSectionCopy {
    connect: string
    emptyTitle: string
    emptyBody: string
}

const DEFAULT_COPY: McpServersSectionCopy = {
    connect: "Connect MCP",
    emptyTitle: "No MCP servers connected yet",
    emptyBody: "Connect a server by URL to give your agents new tools.",
}

export interface McpServersSectionProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: ConfirmDestructive
    /** Hides every write affordance. */
    readOnly?: boolean
    copy?: Partial<McpServersSectionCopy>
}

export default function McpServersSection({
    confirm,
    readOnly,
    copy: copyOverrides,
}: McpServersSectionProps) {
    const copy = useMemo<McpServersSectionCopy>(
        () => ({...DEFAULT_COPY, ...copyOverrides}),
        [copyOverrides],
    )

    const {data: endpoints, isPending} = useAtomValue(mcpEndpointsQueryAtom)
    const refresh = useSetAtom(refreshMcpEndpointsAtom)
    const disconnect = useSetAtom(disconnectMcpEndpointAtom)
    const deleteEndpoint = useSetAtom(deleteMcpEndpointAtom)

    const [connecting, setConnecting] = useState(false)
    const [reconnecting, setReconnecting] = useState<MCPEndpoint | null>(null)
    const [viewing, setViewing] = useState<MCPEndpoint | null>(null)

    const rows = useMemo(() => endpoints ?? [], [endpoints])
    const names = useMemo(() => rows.map((row) => row.name), [rows])

    const openConnect = useCallback(() => {
        setReconnecting(null)
        setConnecting(true)
    }, [])

    const openReconnect = useCallback((endpoint: MCPEndpoint) => {
        setViewing(null)
        setReconnecting(endpoint)
        setConnecting(true)
    }, [])

    const closeConnect = useCallback(() => {
        setConnecting(false)
        setReconnecting(null)
    }, [])

    const handleDisconnect = useCallback(
        (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            const label = endpoint.name || endpoint.slug || "this server"
            const run = async () => {
                try {
                    await disconnect(endpoint.id as string)
                    setViewing(null)
                    message.success("MCP server disconnected.")
                } catch (error) {
                    message.error(
                        (error as Error)?.message || "Failed to disconnect the MCP server.",
                    )
                }
            }
            if (!confirm) return void run()
            confirm({
                title: "Disconnect server",
                message: `Agents using ${label} stop working until it is connected again. The server and its tools are kept.`,
                onOk: run,
            })
        },
        [confirm, disconnect],
    )

    const handleDelete = useCallback(
        (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            const label = endpoint.name || endpoint.slug || "this server"
            const run = async () => {
                try {
                    await deleteEndpoint(endpoint.id as string)
                    setViewing(null)
                    message.success("MCP server removed.")
                } catch (error) {
                    message.error((error as Error)?.message || "Failed to remove the MCP server.")
                }
            }
            if (!confirm) return void run()
            confirm({
                title: "Remove server",
                // Removing takes the identity with it, which disconnecting does not.
                message: `${label} is removed from this project. Agents configured to use it stop working, and reconnecting later creates a new connection.`,
                onOk: run,
            })
        },
        [confirm, deleteEndpoint],
    )

    const columns = useMemo<DataTableColumn<MCPEndpoint>[]>(
        () => [
            {
                key: "name",
                title: "Name",
                render: (record) => (
                    <span data-testid="mcp-connection-name" className="font-medium">
                        {record.name || record.slug}
                    </span>
                ),
            },
            {
                key: "url",
                title: "Server URL",
                render: (record) => (
                    <span
                        className="block truncate text-colorTextDescription"
                        title={record.data.route.base_url ?? undefined}
                    >
                        {record.data.route.base_url}
                    </span>
                ),
            },
            {
                key: "status",
                title: "Status",
                render: (record) => {
                    const state = getMcpConnectionState(record)
                    return (
                        <Tag
                            data-testid="mcp-connection-status"
                            tone={state === "ready" ? "green" : "gold"}
                            className="m-0 text-xs"
                        >
                            {getMcpConnectionStateLabel(state)}
                        </Tag>
                    )
                },
            },
        ],
        [],
    )

    return (
        <div className="flex flex-col gap-3">
            <div className="flex justify-end">
                {readOnly ? null : (
                    <Button data-testid="mcp-connect-open" onClick={openConnect}>
                        <Plus size={14} />
                        {copy.connect}
                    </Button>
                )}
            </div>

            {!isPending && rows.length === 0 ? (
                <EmptyState image="simple" description={copy.emptyBody} title={copy.emptyTitle}>
                    {readOnly ? null : (
                        <Button data-testid="mcp-connect-open" onClick={openConnect}>
                            {copy.connect}
                        </Button>
                    )}
                </EmptyState>
            ) : (
                <DataTable<MCPEndpoint>
                    columns={columns}
                    rows={rows}
                    loading={isPending}
                    rowKey={(record) => record.id ?? record.slug ?? ""}
                    onRowClick={(record) => setViewing(record)}
                    actions={
                        readOnly
                            ? undefined
                            : (record) => [
                                  {
                                      key: "open",
                                      label: "Open",
                                      onClick: () => setViewing(record),
                                  },
                                  {
                                      key: "connect",
                                      label:
                                          getMcpConnectionState(record) === "ready"
                                              ? "Reconnect"
                                              : "Connect",
                                      onClick: () => openReconnect(record),
                                  },
                                  {
                                      key: "disconnect",
                                      label: "Disconnect",
                                      // Only where there is a grant to revoke. A server that
                                      // needs no authentication is ready without holding one,
                                      // and the route refuses a non-OAuth endpoint outright.
                                      hidden:
                                          record.auth_mode !== "oauth" ||
                                          getMcpConnectionState(record) !== "ready",
                                      onClick: () => handleDisconnect(record),
                                  },
                                  {
                                      key: "delete",
                                      label: "Remove",
                                      danger: true,
                                      onClick: () => handleDelete(record),
                                  },
                              ]
                    }
                />
            )}

            <McpConnectJourney
                open={connecting}
                onClose={closeConnect}
                existingNames={names}
                reconnect={
                    reconnecting?.id && reconnecting.slug
                        ? {
                              id: reconnecting.id,
                              slug: reconnecting.slug,
                              name: reconnecting.name || reconnecting.slug,
                              url: reconnecting.data.route.base_url || "",
                          }
                        : null
                }
                onConnected={() => void refresh()}
            />

            <McpConnectionDetail
                endpoint={viewing}
                onClose={() => setViewing(null)}
                existingNames={names}
                onReconnect={openReconnect}
                onDisconnect={handleDisconnect}
                onChanged={() => void refresh()}
            />
        </div>
    )
}
