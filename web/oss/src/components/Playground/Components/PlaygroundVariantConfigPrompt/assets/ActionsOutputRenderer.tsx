import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {CaretRight, MagnifyingGlass, Plus} from "@phosphor-icons/react"
import {Button, Divider, Dropdown, Input, Spin, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import Image from "next/image"

import LLMIconMap from "@/oss/components/LLMIcons"
import {getPromptById, getLLMConfig} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"
import {
    catalogDrawerOpenAtom,
    useCatalogActions,
    useConnectionsQuery,
    useIntegrationDetail,
} from "@/oss/features/gateway-tools"
import CatalogDrawer from "@/oss/features/gateway-tools/drawers/CatalogDrawer"
import ToolExecutionDrawer from "@/oss/features/gateway-tools/drawers/ToolExecutionDrawer"
import {buildToolSlug} from "@/oss/features/gateway-tools/hooks/useToolExecution"
import {fetchActionDetail} from "@/oss/services/tools/api"
import type {ConnectionItem} from "@/oss/services/tools/api/types"

import AddButton from "../../../assets/AddButton"
import {
    addPromptMessageMutationAtomFamily,
    addPromptToolMutationAtomFamily,
} from "../../../state/atoms/promptMutations"
import {TOOL_PROVIDERS_META} from "../../PlaygroundTool/assets"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"

import TemplateFormatSelector from "./TemplateFormatSelector"
import toolsSpecs from "./tools.specs.json"

interface Props {
    variantId: string
    compoundKey: string
    viewOnly?: boolean
}

interface ComposioActionSelectParams {
    providerKey: string
    integrationKey: string
    integrationName: string
    connectionSlug: string
    actionKey: string
    actionName: string
    payload: Record<string, any>
}

const formatToolLabel = (toolCode: string) =>
    toolCode
        .split("_")
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ")

function PanelScrollSentinel({
    onVisible,
    hasMore,
    isFetching,
    scrollRootRef,
    observeKey,
}: {
    onVisible: () => void
    hasMore: boolean
    isFetching: boolean
    scrollRootRef: React.RefObject<HTMLDivElement | null>
    observeKey: string
}) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = ref.current
        if (!el || !hasMore || isFetching) return

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !isFetching) {
                    onVisible()
                }
            },
            {
                root: scrollRootRef.current ?? null,
                rootMargin: "160px",
                threshold: 0.01,
            },
        )
        observer.observe(el)

        return () => observer.disconnect()
    }, [onVisible, hasMore, isFetching, scrollRootRef, observeKey])

    if (!hasMore) return null
    return <div ref={ref} className="h-px shrink-0" />
}

// Right panel: actions for a Composio connection (lazy-fetched, infinite scroll)
function ComposioActionsList({
    providerKey,
    integrationKey,
    connectionSlug,
    scrollRootRef,
    onSelectAction,
}: {
    providerKey: string
    integrationKey: string
    connectionSlug: string
    scrollRootRef: React.RefObject<HTMLDivElement | null>
    onSelectAction: (params: ComposioActionSelectParams) => void
}) {
    const {
        actions,
        total,
        prefetchThreshold,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        requestMore,
        setSearch,
    } = useCatalogActions(integrationKey)
    const {integration} = useIntegrationDetail(integrationKey)
    const [searchTerm, setSearchTerm] = useState("")
    const sentinelIndex = useMemo(
        () => Math.max(0, actions.length - prefetchThreshold),
        [actions.length, prefetchThreshold],
    )

    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(searchTerm.trim())
        }, 250)

        return () => clearTimeout(timer)
    }, [searchTerm, setSearch])

    useEffect(() => {
        setSearch("")
        setSearchTerm("")

        return () => setSearch("")
    }, [integrationKey, setSearch])

    const handleActionClick = async (actionKey: string, actionName: string) => {
        const integrationName = integration?.name || integrationKey

        let inputSchema: Record<string, unknown> = {type: "object", properties: {}}
        try {
            const detail = await fetchActionDetail(providerKey, integrationKey, actionKey)
            if (detail?.action?.schemas?.inputs) {
                inputSchema = detail.action.schemas.inputs as Record<string, unknown>
            }
        } catch {
            // fall back to empty schema
        }

        onSelectAction({
            providerKey,
            integrationKey,
            integrationName,
            connectionSlug,
            actionKey,
            actionName,
            payload: {
                type: "function",
                function: {
                    name: buildToolSlug(providerKey, integrationKey, actionKey, connectionSlug),
                    description: actionName,
                    parameters: inputSchema,
                },
            },
        })
    }

    return (
        <div className="flex flex-col min-h-0">
            <div className="sticky top-0 z-10 bg-white">
                <div className="p-2">
                    <Input
                        allowClear
                        variant="borderless"
                        value={searchTerm}
                        placeholder="Search actions"
                        onChange={(event) => setSearchTerm(event.target.value)}
                        onClear={() => setSearchTerm("")}
                        prefix={<MagnifyingGlass size={14} className="text-[#98A2B3]" />}
                        className="flex-1 !shadow-none !outline-none !border-none focus:!shadow-none focus:!outline-none focus:!border-none"
                    />
                </div>
                <Divider className="m-0" orientation="horizontal" />
            </div>

            <div className="p-1">
                {isLoading && actions.length === 0 ? (
                    <div className="flex justify-center py-4">
                        <Spin size="small" />
                    </div>
                ) : !actions.length ? (
                    <div className="py-3 px-2 text-[11px] text-[#7E8B99]">No actions found</div>
                ) : (
                    <>
                        {actions.map((action, index) => (
                            <React.Fragment key={action.key}>
                                {index === sentinelIndex && (
                                    <PanelScrollSentinel
                                        onVisible={requestMore}
                                        hasMore={hasNextPage}
                                        isFetching={isFetchingNextPage}
                                        scrollRootRef={scrollRootRef}
                                        observeKey={`${integrationKey}:${actions.length}:threshold`}
                                    />
                                )}
                                <Button
                                    type="text"
                                    block
                                    className="!flex !h-[28px] !items-center !justify-start !text-left !py-[5px] !px-2 hover:!bg-[#F8FAFC]"
                                    onClick={() => handleActionClick(action.key, action.name)}
                                >
                                    <span className="text-[#0F172A] text-xs truncate">
                                        {action.name}
                                    </span>
                                </Button>
                                {index < actions.length - 1 && (
                                    <div className="mx-2 h-px bg-[#F1F5F9]" />
                                )}
                            </React.Fragment>
                        ))}

                        <PanelScrollSentinel
                            onVisible={requestMore}
                            hasMore={hasNextPage}
                            isFetching={isFetchingNextPage}
                            scrollRootRef={scrollRootRef}
                            observeKey={`${integrationKey}:${actions.length}:bottom`}
                        />

                        {isFetchingNextPage && (
                            <div className="flex justify-center py-2 shrink-0">
                                <Spin size="small" />
                            </div>
                        )}
                        {!isFetchingNextPage && hasNextPage && (
                            <div className="flex justify-center py-2">
                                <Button
                                    type="text"
                                    size="small"
                                    className="text-[11px] text-[#7E8B99]"
                                    onClick={requestMore}
                                >
                                    Load more
                                </Button>
                            </div>
                        )}
                        <div className="text-[10px] text-[#94A3B8] px-2 pb-1">
                            Showing {Math.min(actions.length, total)} of {total}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

// Left panel row — one per connection, shows integration_key / connection_slug
function ConnectionRow({
    connection,
    isHovered,
    onHover,
}: {
    connection: ConnectionItem
    isHovered: boolean
    onHover: () => void
}) {
    const {integration} = useIntegrationDetail(connection.integration_key)

    return (
        <Button
            type="text"
            block
            onMouseEnter={onHover}
            className={clsx(
                "!flex !h-[28px] !items-center !gap-1.5 !py-[5px] !px-1.5 !text-left",
                isHovered ? "!bg-[#EFF6FF]" : "hover:!bg-[#F8FAFC]",
            )}
        >
            {integration?.logo ? (
                <Image
                    src={integration.logo}
                    alt={connection.integration_key}
                    width={16}
                    height={16}
                    className="h-4 w-4 rounded object-contain shrink-0"
                    unoptimized
                />
            ) : (
                <span className="h-4 w-4 rounded bg-[#F1F5F9] shrink-0" />
            )}
            <Typography.Text className="flex-1 text-[#0F172A] text-xs truncate">
                <span className="capitalize">{connection.integration_key.replace(/_/g, " ")}</span>
                <span className="text-[#CBD5E1] mx-1">/</span>
                <span className="text-[#64748B]">{connection.slug}</span>
            </Typography.Text>
            <CaretRight size={10} className="text-[#CBD5E1] shrink-0" />
        </Button>
    )
}

const ActionsOutputRenderer: React.FC<Props> = ({variantId, compoundKey, viewOnly}) => {
    const addNewMessage = useSetAtom(addPromptMessageMutationAtomFamily(compoundKey))
    const addNewTool = useSetAtom(addPromptToolMutationAtomFamily(compoundKey))
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [hoveredKey, setHoveredKey] = useState<string | null>(null)
    const [leftPanelHeight, setLeftPanelHeight] = useState<number | undefined>(undefined)
    const leftPanelRef = useRef<HTMLDivElement>(null)
    const rightPanelRef = useRef<HTMLDivElement>(null)

    const handleRowHover = useCallback((key: string) => {
        if (leftPanelRef.current) {
            setLeftPanelHeight(leftPanelRef.current.offsetHeight)
        }
        setHoveredKey(key)
    }, [])

    // promptId may contain colons (e.g. "prompt:prompt1"), so split only on the first ":"
    const promptId = compoundKey.substring(compoundKey.indexOf(":") + 1)
    const prompts = usePromptsSource(variantId)

    const setCatalogOpen = useSetAtom(catalogDrawerOpenAtom)
    const {
        connections,
        isLoading: connectionsLoading,
        refetch: refetchConnections,
    } = useConnectionsQuery()

    const responseFormatInfo = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        const llm = getLLMConfig(item)
        const enhancedId = llm?.responseFormat?.__id || llm?.response_format?.__id
        const raw = llm?.response_format || llm?.responseFormat

        return {enhancedId, raw}
    }, [prompts, promptId])
    const responseFormatId = responseFormatInfo.enhancedId as string | undefined

    const filteredToolGroups = useMemo(() => {
        const normalizedTerm = searchTerm.trim().toLowerCase()

        return Object.entries(toolsSpecs).reduce<
            {
                key: string
                label: string
                Icon?: React.FC<{className?: string}>
                tools: {code: string; label: string; payload: Record<string, any>}[]
            }[]
        >((groups, [providerKey, tools]) => {
            const meta = TOOL_PROVIDERS_META[providerKey] ?? {label: providerKey}
            const Icon = meta.iconKey ? LLMIconMap[meta.iconKey] : undefined
            const providerMatches =
                normalizedTerm && meta.label.toLowerCase().includes(normalizedTerm)

            const toolEntries = Object.entries(tools).map(([toolCode, toolSpec]) => ({
                code: toolCode,
                label: formatToolLabel(toolCode),
                payload: Array.isArray(toolSpec) ? toolSpec[0] : toolSpec,
            }))

            const matchingTools = toolEntries.filter((tool) => {
                if (!normalizedTerm) return true
                return (
                    providerMatches ||
                    tool.label.toLowerCase().includes(normalizedTerm) ||
                    tool.code.toLowerCase().includes(normalizedTerm)
                )
            })

            if (matchingTools.length) {
                groups.push({key: providerKey, label: meta.label, Icon, tools: matchingTools})
            }

            return groups
        }, [])
    }, [searchTerm])

    // Filter connections by search term
    const filteredConnections = useMemo(() => {
        const normalizedTerm = searchTerm.trim().toLowerCase()
        if (!normalizedTerm) return connections
        return connections.filter(
            (conn) =>
                conn.integration_key.toLowerCase().includes(normalizedTerm) ||
                (conn.name || conn.slug).toLowerCase().includes(normalizedTerm),
        )
    }, [connections, searchTerm])

    const hasBuiltin = filteredToolGroups.length > 0
    const hasComposio = connectionsLoading || filteredConnections.length > 0

    const closeDropdown = useCallback(() => {
        setIsDropdownOpen(false)
        setSearchTerm("")
        setHoveredKey(null)
    }, [])

    const handleAddTool = useCallback(
        (params?: {
            payload?: Record<string, any>
            source?: "inline" | "builtin"
            providerKey?: string
            providerLabel?: string
            toolCode?: string
            toolLabel?: string
        }) => {
            addNewTool(params)
            closeDropdown()
        },
        [addNewTool, closeDropdown],
    )

    const handleComposioActionAdd = useCallback(
        ({
            providerKey,
            integrationKey,
            integrationName,
            connectionSlug,
            actionKey,
            actionName,
            payload,
        }: ComposioActionSelectParams) => {
            addNewTool({
                source: "builtin",
                providerKey,
                providerLabel: integrationName,
                toolCode: `${connectionSlug}/${actionKey}`,
                toolLabel: actionName,
                payload,
            })
            closeDropdown()
        },
        [addNewTool, closeDropdown],
    )

    // Derive right-panel content from hoveredKey
    const hoveredBuiltinGroup = hoveredKey?.startsWith("builtin:")
        ? filteredToolGroups.find((g) => g.key === hoveredKey.slice("builtin:".length))
        : null
    const hoveredConnection = hoveredKey?.startsWith("composio:")
        ? connections.find((c) => c.id === hoveredKey.slice("composio:".length))
        : null
    const showRightPanel = !!(hoveredBuiltinGroup || hoveredConnection)

    const dropdownContent = (
        <div
            className="flex items-start bg-white rounded-lg shadow-lg overflow-hidden"
            onMouseLeave={() => setHoveredKey(null)}
        >
            {/* Left panel */}
            <div ref={leftPanelRef} className="w-[220px] flex flex-col shrink-0">
                <div className="max-h-80 overflow-y-auto flex flex-col">
                    <div className="sticky top-0 z-10 bg-white">
                        <div className="p-2">
                            <Input
                                allowClear
                                autoFocus
                                variant="borderless"
                                placeholder="Search integrations"
                                value={searchTerm}
                                onChange={(event) => {
                                    setSearchTerm(event.target.value)
                                    setHoveredKey(null)
                                }}
                                prefix={<MagnifyingGlass size={16} className="text-[#98A2B3]" />}
                                className="flex-1 !shadow-none !outline-none !border-none focus:!shadow-none focus:!outline-none focus:!border-none"
                            />
                        </div>
                        <Divider className="m-0" orientation="horizontal" />
                    </div>

                    <div className="p-1">
                        {/* Builtin section */}
                        {hasBuiltin && (
                            <div className="flex flex-col">
                                <Typography.Text className="text-[#758391] text-xs py-[5px] px-1.5 font-medium">
                                    Builtin
                                </Typography.Text>
                                {filteredToolGroups.map(({key, label, Icon}) => (
                                    <Button
                                        key={key}
                                        type="text"
                                        block
                                        onMouseEnter={() => handleRowHover(`builtin:${key}`)}
                                        className={clsx(
                                            "!flex !h-[28px] !items-center !gap-1.5 !py-[5px] !px-1.5 !text-left",
                                            hoveredKey === `builtin:${key}`
                                                ? "!bg-[#EFF6FF]"
                                                : "hover:!bg-[#F8FAFC]",
                                        )}
                                    >
                                        {Icon ? (
                                            <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-[#F8FAFC] shrink-0">
                                                <Icon className="h-3.5 w-3.5 text-[#758391]" />
                                            </span>
                                        ) : (
                                            <span className="h-5 w-5 shrink-0" />
                                        )}
                                        <Typography.Text className="flex-1 text-[#0F172A] text-xs">
                                            {label}
                                        </Typography.Text>
                                        <CaretRight size={10} className="text-[#CBD5E1] shrink-0" />
                                    </Button>
                                ))}
                            </div>
                        )}

                        {/* Composio section */}
                        {hasComposio && (
                            <>
                                {hasBuiltin && (
                                    <Divider className="my-1" orientation="horizontal" />
                                )}
                                <div className="flex items-center justify-between py-[5px] px-1.5">
                                    <Typography.Text className="text-[#758391] text-xs font-medium">
                                        Composio
                                    </Typography.Text>
                                    <Tooltip title="Add integration">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Plus size={12} />}
                                            className="h-5 w-5 flex items-center justify-center p-0 text-[#758391]"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setIsDropdownOpen(false)
                                                setCatalogOpen(true)
                                            }}
                                        />
                                    </Tooltip>
                                </div>
                                {connectionsLoading ? (
                                    <div className="flex justify-center py-2">
                                        <Spin size="small" />
                                    </div>
                                ) : (
                                    filteredConnections.map((conn) => (
                                        <ConnectionRow
                                            key={conn.id}
                                            connection={conn}
                                            isHovered={hoveredKey === `composio:${conn.id}`}
                                            onHover={() => handleRowHover(`composio:${conn.id}`)}
                                        />
                                    ))
                                )}
                            </>
                        )}

                        {/* Inline section */}
                        {(hasBuiltin || hasComposio) && (
                            <Divider className="my-1" orientation="horizontal" />
                        )}
                        <div className="flex items-center justify-between py-[5px] px-1.5">
                            <Typography.Text className="text-[#758391] text-xs font-medium">
                                Inline
                            </Typography.Text>
                            <Tooltip title="Add inline tool">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<Plus size={12} />}
                                    className="h-5 w-5 flex items-center justify-center p-0 text-[#758391]"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleAddTool({source: "inline"})
                                    }}
                                />
                            </Tooltip>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right panel: actions on hover — height locked to left panel */}
            {showRightPanel && (
                <>
                    <div className="w-px self-stretch shrink-0 bg-[#F0F0F0]" />
                    <div
                        ref={rightPanelRef}
                        className="w-[220px] overflow-y-auto flex flex-col shrink-0"
                        style={leftPanelHeight ? {height: leftPanelHeight} : undefined}
                    >
                        {hoveredBuiltinGroup && hoveredBuiltinGroup.tools.length > 0 && (
                            <div className="p-1">
                                {hoveredBuiltinGroup.tools.map(
                                    ({code, label: toolLabel, payload}, index) => (
                                        <React.Fragment key={code}>
                                            <Button
                                                type="text"
                                                block
                                                className="!flex !h-[28px] !items-center !justify-start !text-left !py-[5px] !px-2 hover:!bg-[#F8FAFC]"
                                                onClick={() =>
                                                    handleAddTool({
                                                        payload,
                                                        source: "builtin",
                                                        providerKey: hoveredBuiltinGroup.key,
                                                        providerLabel: hoveredBuiltinGroup.label,
                                                        toolCode: code,
                                                        toolLabel,
                                                    })
                                                }
                                            >
                                                <span className="text-[#0F172A] text-xs">
                                                    {toolLabel}
                                                </span>
                                            </Button>
                                            {index < hoveredBuiltinGroup.tools.length - 1 && (
                                                <div className="mx-2 h-px bg-[#F1F5F9]" />
                                            )}
                                        </React.Fragment>
                                    ),
                                )}
                            </div>
                        )}

                        {hoveredConnection && (
                            <ComposioActionsList
                                key={hoveredConnection.id}
                                providerKey={hoveredConnection.provider_key}
                                integrationKey={hoveredConnection.integration_key}
                                connectionSlug={hoveredConnection.slug}
                                scrollRootRef={rightPanelRef}
                                onSelectAction={handleComposioActionAdd}
                            />
                        )}
                    </div>
                </>
            )}
        </div>
    )

    return (
        <div
            className={clsx(["flex gap-1 flex-wrap w-full", "mb-6"], {
                "[&>_div]:!w-full": viewOnly,
            })}
        >
            {!viewOnly && (
                <>
                    <AddButton
                        className="mt-2"
                        size="small"
                        label="Message"
                        onClick={addNewMessage}
                    />
                    <Dropdown
                        open={isDropdownOpen}
                        onOpenChange={(open) => {
                            setIsDropdownOpen(open)
                            if (!open) {
                                setSearchTerm("")
                                setHoveredKey(null)
                            }
                        }}
                        trigger={["click"]}
                        menu={{items: []}}
                        popupRender={() => dropdownContent}
                        placement="bottomLeft"
                    >
                        <AddButton
                            className="mt-2"
                            size="small"
                            label="Tool"
                            onClick={() => setIsDropdownOpen(true)}
                        />
                    </Dropdown>
                </>
            )}
            <div>
                {responseFormatId ? (
                    <PlaygroundVariantPropertyControl
                        variantId={variantId}
                        propertyId={responseFormatId}
                        viewOnly={viewOnly}
                        disabled={viewOnly}
                        className="!min-h-0 [&_div]:!mb-0"
                    />
                ) : (
                    // Fallback for immutable/raw params (no property id)
                    <span className="text-[#7E8B99] text-[12px] leading-[20px] block">
                        {(() => {
                            const t = (responseFormatInfo.raw || {})?.type
                            if (!t || t === "text") return "Default (text)"
                            if (t === "json_object") return "JSON mode"
                            if (t === "json_schema") return "JSON schema"
                            return String(t)
                        })()}
                    </span>
                )}
            </div>
            <TemplateFormatSelector variantId={variantId} disabled={viewOnly} />

            <CatalogDrawer onConnectionCreated={refetchConnections} />
            <ToolExecutionDrawer />
        </div>
    )
}

export default ActionsOutputRenderer
