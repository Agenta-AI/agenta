import {useCallback, useMemo, useState} from "react"

import {SecretKind, vaultSecretsQueryAtom} from "@agenta/entities/secret"
import {useStaticTable} from "@agenta/settings"
import {message} from "@agenta/ui"
import {
    InfiniteVirtualTableFeatureShell,
    createStandardColumns,
    type StandardColumnDef,
} from "@agenta/ui/table"
import {EmptyState} from "@agenta/ui/ui"
import {PencilSimpleLine, Plug, Plus, Trash} from "@phosphor-icons/react"
import {Button, Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {MCPEndpoint} from "@/oss/services/mcpEndpoints/types"
import {
    deleteMcpEndpointAtom,
    mcpEndpointsAtom,
    refreshMcpEndpointsAtom,
} from "@/oss/state/mcpEndpoints/atoms"

import ComposioProjectKey from "./ComposioProjectKey"
import {
    getMcpConnectionState,
    getMcpConnectionStateLabel,
    type McpConnectionState,
} from "./connectionState"
import MCPConnectDialog from "./MCPConnectDialog"
import MCPEndpointDrawer from "./MCPEndpointDrawer"

interface MCPEndpointRow extends MCPEndpoint {
    key: string
    [extra: string]: unknown
}

const MCPEndpoints: React.FC = () => {
    const {data: endpoints, isPending: isLoading} = useAtomValue(mcpEndpointsAtom)
    const vaultSecrets = useAtomValue(vaultSecretsQueryAtom)
    const deleteEndpoint = useSetAtom(deleteMcpEndpointAtom)
    const refreshEndpoints = useSetAtom(refreshMcpEndpointsAtom)

    const [isDrawerOpen, setIsDrawerOpen] = useState(false)
    const [editingEndpoint, setEditingEndpoint] = useState<MCPEndpoint | null>(null)
    const [connectingEndpoint, setConnectingEndpoint] = useState<MCPEndpoint | null>(null)

    const hasComposioProjectKey = useMemo(
        () =>
            vaultSecrets.data?.some(
                (secret) =>
                    secret.type === SecretKind.ProviderKey && secret.name === "COMPOSIO_API_KEY",
            ) ?? false,
        [vaultSecrets.data],
    )

    const handleCreate = useCallback(() => {
        setEditingEndpoint(null)
        setIsDrawerOpen(true)
    }, [])

    const handleEdit = useCallback((endpoint: MCPEndpoint) => {
        setEditingEndpoint(endpoint)
        setIsDrawerOpen(true)
    }, [])

    const handleDelete = useCallback(
        async (endpoint: MCPEndpoint) => {
            if (!endpoint.id) return
            try {
                await deleteEndpoint(endpoint.id)
                message.success("MCP server removed.")
            } catch (error) {
                message.error((error as Error)?.message || "Failed to remove the MCP server.")
            }
        },
        [deleteEndpoint],
    )

    const handleDrawerClose = useCallback(() => {
        setIsDrawerOpen(false)
        setEditingEndpoint(null)
    }, [])

    const handleConnect = useCallback((endpoint: MCPEndpoint) => {
        setConnectingEndpoint(endpoint)
    }, [])

    const rows = useMemo<MCPEndpointRow[]>(
        () =>
            (endpoints ?? []).map((endpoint) => ({
                ...endpoint,
                key:
                    endpoint.id ??
                    `${endpoint.namespace ?? "custom"}:${endpoint.provider_key ?? ""}:${endpoint.integration_key ?? ""}:${endpoint.slug ?? endpoint.name ?? "endpoint"}`,
            })),
        [endpoints],
    )

    const columns = useMemo(
        () =>
            createStandardColumns<MCPEndpointRow>([
                {
                    type: "text",
                    key: "namespace",
                    title: "Kind",
                    width: 120,
                    render: (_value, record) => record.namespace ?? "custom",
                },
                {
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 200,
                    fixed: "left",
                    render: (_value, record) => record.name || record.slug || "-",
                },
                {
                    type: "text",
                    key: "url",
                    title: "Server URL",
                    width: 320,
                    render: (_value, record) => (
                        <span
                            className="block truncate"
                            title={record.data.route.base_url ?? undefined}
                        >
                            {record.data.route.base_url || "Managed gateway"}
                        </span>
                    ),
                },
                {
                    type: "text",
                    key: "auth_mode",
                    title: "Auth",
                    width: 120,
                    render: (_value, record) => record.auth_mode,
                },
                {
                    type: "text",
                    key: "status",
                    title: "Status",
                    width: 140,
                    render: (_value, record) => {
                        const connectionState: McpConnectionState =
                            record.namespace === "standard" && record.provider_key === "composio"
                                ? hasComposioProjectKey
                                    ? "ready"
                                    : "needs_input"
                                : getMcpConnectionState(record)
                        const color =
                            connectionState === "ready"
                                ? "success"
                                : connectionState === "needs_auth"
                                  ? "warning"
                                  : "default"
                        return (
                            <Tag color={color}>{getMcpConnectionStateLabel(connectionState)}</Tag>
                        )
                    },
                },
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "connect",
                            label: "Connect / reconnect",
                            icon: <Plug size={16} />,
                            hidden: (record: MCPEndpointRow) =>
                                record.namespace !== "custom" || record.auth_mode !== "oauth",
                            onClick: (record: MCPEndpointRow) => handleConnect(record),
                        },
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            hidden: (record: MCPEndpointRow) => record.namespace !== "custom",
                            onClick: (record: MCPEndpointRow) => handleEdit(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            hidden: (record: MCPEndpointRow) => record.namespace !== "custom",
                            onClick: (record: MCPEndpointRow) => handleDelete(record),
                        },
                    ],
                } satisfies StandardColumnDef<MCPEndpointRow>,
            ]),
        [handleConnect, handleDelete, handleEdit, hasComposioProjectKey],
    )

    const {tableScope, pagination} = useStaticTable<MCPEndpointRow>(
        "settings-mcp-endpoints",
        rows,
        {
            loading: isLoading,
        },
    )

    return (
        <div className="flex flex-col gap-2">
            <ComposioProjectKey />
            <InfiniteVirtualTableFeatureShell<MCPEndpointRow>
                tableScope={tableScope}
                autoHeight={false}
                columns={columns}
                rowKey="key"
                pagination={pagination}
                primaryActions={
                    <Button type="primary" icon={<Plus size={14} />} onClick={handleCreate}>
                        Register server
                    </Button>
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
                                        <span className="text-xs font-medium text-colorText">
                                            No MCP servers yet
                                        </span>
                                        <span>
                                            Register a server by URL to give your agents new tools.
                                        </span>
                                    </div>
                                }
                            >
                                <Button icon={<Plus size={14} />} onClick={handleCreate}>
                                    Register server
                                </Button>
                            </EmptyState>
                        ),
                    },
                    onRow: (record: MCPEndpointRow) =>
                        record.namespace === "custom"
                            ? {
                                  onClick: () => handleEdit(record),
                                  className: "cursor-pointer",
                              }
                            : {},
                }}
            />

            <MCPEndpointDrawer
                open={isDrawerOpen}
                endpoint={editingEndpoint}
                onClose={handleDrawerClose}
            />
            <MCPConnectDialog
                endpoint={connectingEndpoint}
                onClose={() => setConnectingEndpoint(null)}
                onSuccess={() => refreshEndpoints()}
            />
        </div>
    )
}

export default MCPEndpoints
