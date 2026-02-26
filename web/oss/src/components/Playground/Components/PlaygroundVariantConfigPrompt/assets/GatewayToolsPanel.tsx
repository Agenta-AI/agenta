import {useMemo} from "react"

import {Play, Plus} from "@phosphor-icons/react"
import {Button, Collapse, Empty, Spin, Tag, Tooltip, Typography} from "antd"
import {useSetAtom} from "jotai"
import Image from "next/image"

import ConnectionStatusBadge from "@/oss/components/pages/settings/Tools/components/ConnectionStatusBadge"
import {
    useConnectionsQuery,
    catalogDrawerOpenAtom,
    executionDrawerAtom,
    useIntegrationDetail,
} from "@/oss/features/gateway-tools"
import CatalogDrawer from "@/oss/features/gateway-tools/drawers/CatalogDrawer"
import ToolExecutionDrawer from "@/oss/features/gateway-tools/drawers/ToolExecutionDrawer"
import type {ConnectionItem} from "@/oss/services/tools/api/types"

interface GatewayToolsPanelProps {
    mountDrawers?: boolean
}

export default function GatewayToolsPanel({mountDrawers = false}: GatewayToolsPanelProps) {
    const {connections, isLoading, refetch} = useConnectionsQuery()
    const setCatalogOpen = useSetAtom(catalogDrawerOpenAtom)
    const setExecutionDrawer = useSetAtom(executionDrawerAtom)

    // Group connections by integration
    const grouped = useMemo(() => {
        const map: Record<string, ConnectionItem[]> = {}
        for (const conn of connections) {
            const key = conn.integration_key
            if (!map[key]) map[key] = []
            map[key].push(conn)
        }
        return map
    }, [connections])

    const integrationKeys = Object.keys(grouped)

    return (
        <div className="flex flex-col gap-2">
            {/* Header */}
            <div className="flex items-center justify-between">
                <Typography.Text className="text-xs font-medium text-[#888]">
                    GATEWAY TOOLS
                </Typography.Text>
                <Button
                    type="text"
                    size="small"
                    icon={<Plus size={12} />}
                    onClick={() => setCatalogOpen(true)}
                    className="text-xs"
                >
                    Add
                </Button>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex justify-center py-2">
                    <Spin size="small" />
                </div>
            ) : integrationKeys.length === 0 ? (
                <Empty
                    description={
                        <Typography.Text type="secondary" className="text-xs">
                            No gateway tools connected.
                        </Typography.Text>
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    className="my-2"
                />
            ) : (
                <Collapse
                    size="small"
                    items={integrationKeys.map((integrationKey) => ({
                        key: integrationKey,
                        label: <IntegrationSectionLabel integrationKey={integrationKey} />,
                        extra: <Tag className="text-xs">{grouped[integrationKey].length}</Tag>,
                        children: (
                            <div className="flex flex-col gap-1">
                                {grouped[integrationKey].map((conn) => (
                                    <ConnectionRow
                                        key={conn.id}
                                        connection={conn}
                                        onTest={() =>
                                            setExecutionDrawer({
                                                connectionId: conn.id,
                                                connectionSlug: conn.slug,
                                                integrationKey: conn.integration_key,
                                            })
                                        }
                                    />
                                ))}
                            </div>
                        ),
                    }))}
                />
            )}

            {/* Shared drawers (opt-in to avoid duplicate mounts in parent contexts) */}
            {mountDrawers && (
                <>
                    <CatalogDrawer onConnectionCreated={refetch} />
                    <ToolExecutionDrawer />
                </>
            )}
        </div>
    )
}

function IntegrationSectionLabel({integrationKey}: {integrationKey: string}) {
    const {integration} = useIntegrationDetail(integrationKey)
    const label = integration?.name || integrationKey.replace(/_/g, " ")
    const logo = integration?.logo

    return (
        <div className="flex items-center gap-2 min-w-0">
            {logo ? (
                <Image
                    src={logo}
                    alt={label}
                    width={16}
                    height={16}
                    className="h-4 w-4 rounded object-contain shrink-0"
                    unoptimized
                />
            ) : null}
            <Typography.Text className="text-sm truncate">{label}</Typography.Text>
        </div>
    )
}

function ConnectionRow({connection, onTest}: {connection: ConnectionItem; onTest: () => void}) {
    const isReady = connection.flags?.is_active && connection.flags?.is_valid
    const {integration} = useIntegrationDetail(connection.integration_key)
    const label = integration?.name || connection.integration_key.replace(/_/g, " ")
    const logo = integration?.logo

    return (
        <div
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] cursor-pointer"
            onClick={onTest}
        >
            {logo ? (
                <Image
                    src={logo}
                    alt={label}
                    width={16}
                    height={16}
                    className="h-4 w-4 rounded object-contain shrink-0"
                    unoptimized
                />
            ) : null}
            <div className="flex flex-col min-w-0 flex-1 leading-tight">
                <Typography.Text className="text-xs truncate">{connection.name || connection.slug}</Typography.Text>
                <Typography.Text className="text-[10px] text-slate-400 truncate">
                    {label} / {connection.slug}
                </Typography.Text>
            </div>
            <ConnectionStatusBadge connection={connection} />
            <Tooltip title="Test">
                <Button
                    type="text"
                    size="small"
                    aria-label="Test connection"
                    icon={<Play size={12} />}
                    disabled={!isReady}
                    onClick={(e) => {
                        e.stopPropagation()
                        onTest()
                    }}
                />
            </Tooltip>
        </div>
    )
}
