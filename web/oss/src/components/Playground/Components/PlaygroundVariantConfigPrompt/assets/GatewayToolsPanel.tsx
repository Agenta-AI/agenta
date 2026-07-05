import {useMemo} from "react"

import {
    toolCatalogDrawerOpenAtom,
    toolExecutionDrawerAtom,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {
    CatalogDrawer,
    ConnectionStatusBadge,
    ToolExecutionDrawer,
} from "@agenta/entity-ui/gatewayTool"
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@agenta/primitive-ui/components/accordion"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {Play, Plus} from "@phosphor-icons/react"
import {Empty} from "antd"
import {useSetAtom} from "jotai"
import Image from "next/image"

interface GatewayToolsPanelProps {
    mountDrawers?: boolean
}

export default function GatewayToolsPanel({mountDrawers = false}: GatewayToolsPanelProps) {
    const {connections, isLoading, refetch} = useToolConnectionsQuery()
    const setCatalogOpen = useSetAtom(toolCatalogDrawerOpenAtom)
    const setExecutionDrawer = useSetAtom(toolExecutionDrawerAtom)

    // Group connections by integration
    const grouped = useMemo(() => {
        const map: Record<string, ToolConnection[]> = {}
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
                <span className="text-xs font-medium text-[var(--ag-c-888)]">GATEWAY TOOLS</span>
                <Button
                    onClick={() => setCatalogOpen(true)}
                    className="text-xs"
                    variant="ghost"
                    size="sm"
                >
                    {<Plus size={12} />}
                    Add
                </Button>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="flex justify-center py-2">
                    <Spinner className="size-3.5" />
                </div>
            ) : integrationKeys.length === 0 ? (
                <Empty
                    description={
                        <span className="text-xs text-muted-foreground">
                            No gateway tools connected.
                        </span>
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    className="my-2"
                />
            ) : (
                <Accordion
                    multiple
                    className="[&_[data-slot=accordion-trigger]]:!py-1.5 [&_[data-slot=accordion-content]>div]:!pt-1 [&_[data-slot=accordion-content]>div]:!pb-1.5"
                >
                    {integrationKeys.map((integrationKey) => (
                        <AccordionItem value={integrationKey} key={integrationKey}>
                            <AccordionTrigger>
                                <IntegrationSectionLabel integrationKey={integrationKey} />
                                <Badge className="text-xs" variant="secondary">
                                    {grouped[integrationKey].length}
                                </Badge>
                            </AccordionTrigger>
                            <AccordionContent>
                                <div className="flex flex-col gap-1">
                                    {grouped[integrationKey].map((conn, index) => (
                                        <ConnectionRow
                                            key={
                                                conn.id ?? conn.slug ?? `${integrationKey}-${index}`
                                            }
                                            connection={conn}
                                            onTest={() => {
                                                if (!conn.id || !conn.slug) return
                                                setExecutionDrawer({
                                                    connectionId: conn.id,
                                                    connectionSlug: conn.slug,
                                                    integrationKey: conn.integration_key,
                                                })
                                            }}
                                        />
                                    ))}
                                </div>
                            </AccordionContent>
                        </AccordionItem>
                    ))}
                </Accordion>
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
    const {integration} = useToolIntegrationDetail(integrationKey)
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
            <span className="text-sm truncate">{label}</span>
        </div>
    )
}

function ConnectionRow({connection, onTest}: {connection: ToolConnection; onTest: () => void}) {
    const isReady = connection.flags?.is_active && connection.flags?.is_valid
    const {integration} = useToolIntegrationDetail(connection.integration_key)
    const label = integration?.name || connection.integration_key.replace(/_/g, " ")
    const logo = integration?.logo

    return (
        <div
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--ag-c-F5F5F5)] dark:hover:bg-[var(--ag-c-2A2A2A)] cursor-pointer"
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
                <span className="text-xs truncate">{connection.name || connection.slug}</span>
                <span className="text-[10px] text-slate-400 truncate">
                    {label} / {connection.slug}
                </span>
            </div>
            <ConnectionStatusBadge connection={connection} />
            <Tooltip>
                <TooltipTrigger
                    render={
                        <Button
                            aria-label="Test connection"
                            disabled={!isReady}
                            onClick={(e) => {
                                e.stopPropagation()
                                onTest()
                            }}
                            variant="ghost"
                            size="icon-sm"
                        >
                            {<Play size={12} />}
                        </Button>
                    }
                />
                <TooltipContent>{"Test"}</TooltipContent>
            </Tooltip>
        </div>
    )
}
