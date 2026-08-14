import {useCallback, useMemo, useState} from "react"

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

import {useStaticTable} from "@/oss/components/pages/settings/hooks/useStaticTable"
import {MCPEndpoint} from "@/oss/services/mcpEndpoints/types"
import {deleteMcpEndpointAtom, mcpEndpointsAtom} from "@/oss/state/mcpEndpoints/atoms"

import MCPConnectDialog from "./MCPConnectDialog"
import MCPEndpointDrawer from "./MCPEndpointDrawer"

interface MCPEndpointRow extends MCPEndpoint {
    key: string
    [extra: string]: unknown
}

const isConnected = (endpoint: MCPEndpoint) => !!endpoint.secret_id

const MCPEndpoints: React.FC = () => {
    const {data: endpoints, isPending: isLoading} = useAtomValue(mcpEndpointsAtom)
    const deleteEndpoint = useSetAtom(deleteMcpEndpointAtom)

    const [isDrawerOpen, setIsDrawerOpen] = useState(false)
    const [editingEndpoint, setEditingEndpoint] = useState<MCPEndpoint | null>(null)
    const [connectingEndpoint, setConnectingEndpoint] = useState<MCPEndpoint | null>(null)

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
        () => (endpoints ?? []).map((endpoint) => ({...endpoint, key: endpoint.id})),
        [endpoints],
    )

    const columns = useMemo(
        () =>
            createStandardColumns<MCPEndpointRow>([
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
                            {record.data.route.base_url || "-"}
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
                    render: (_value, record) =>
                        record.auth_mode === "oauth" ? (
                            <Tag color={isConnected(record) ? "success" : "default"}>
                                {isConnected(record) ? "Connected" : "Not connected"}
                            </Tag>
                        ) : (
                            "-"
                        ),
                },
                {
                    type: "actions",
                    showCopyId: false,
                    items: [
                        {
                            key: "connect",
                            label: "Connect",
                            icon: <Plug size={16} />,
                            hidden: (record: MCPEndpointRow) =>
                                record.auth_mode !== "oauth" || isConnected(record),
                            onClick: (record: MCPEndpointRow) => handleConnect(record),
                        },
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimpleLine size={16} />,
                            onClick: (record: MCPEndpointRow) => handleEdit(record),
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (record: MCPEndpointRow) => handleDelete(record),
                        },
                    ],
                } satisfies StandardColumnDef<MCPEndpointRow>,
            ]),
        [handleConnect, handleDelete, handleEdit],
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
                    onRow: (record: MCPEndpointRow) => ({
                        onClick: () => handleEdit(record),
                        className: "cursor-pointer",
                    }),
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
            />
        </div>
    )
}

export default MCPEndpoints
