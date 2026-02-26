import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {CaretRight, Check, Code, MagnifyingGlass, Plugs, Plus, Sparkle} from "@phosphor-icons/react"
import {Button, Divider, Dropdown, Input, Spin, Typography, message} from "antd"
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
import {isToolsEnabled} from "@/oss/lib/helpers/isEE"
import {fetchActionDetail} from "@/oss/services/tools/api"
import type {ConnectionItem} from "@/oss/services/tools/api/types"

import AddButton from "../../../assets/AddButton"
import {
    addPromptMessageMutationAtomFamily,
    addPromptToolMutationAtomFamily,
    removePromptToolByNameAtomFamily,
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
}

const formatToolLabel = (toolCode: string) =>
    toolCode
        .split("_")
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ")

const getActionInputSchema = (schema: unknown): Record<string, unknown> => {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return {type: "object", properties: {}}
    }

    const normalized = {...(schema as Record<string, unknown>)}

    if (typeof normalized.type !== "string") {
        normalized.type = "object"
    }

    if (
        normalized.type === "object" &&
        (!normalized.properties ||
            typeof normalized.properties !== "object" ||
            Array.isArray(normalized.properties))
    ) {
        normalized.properties = {}
    }

    return normalized
}

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
    selectedToolNames,
}: {
    providerKey: string
    integrationKey: string
    connectionSlug: string
    scrollRootRef: React.RefObject<HTMLDivElement | null>
    onSelectAction: (params: ComposioActionSelectParams) => Promise<void> | void
    selectedToolNames: Set<string>
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
    const [pendingActionKeys, setPendingActionKeys] = useState<Set<string>>(new Set())
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
        if (pendingActionKeys.has(actionKey)) return

        const integrationName = integration?.name || integrationKey
        setPendingActionKeys((prev) => {
            const next = new Set(prev)
            next.add(actionKey)
            return next
        })

        try {
            await onSelectAction({
                providerKey,
                integrationKey,
                integrationName,
                connectionSlug,
                actionKey,
                actionName,
            })
        } finally {
            setPendingActionKeys((prev) => {
                const next = new Set(prev)
                next.delete(actionKey)
                return next
            })
        }
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
                        prefix={<MagnifyingGlass size={14} className="text-slate-400" />}
                        className="flex-1 !shadow-none !outline-none !border-none focus:!shadow-none focus:!outline-none focus:!border-none"
                    />
                </div>
                <div className="h-px bg-slate-100" />
            </div>

            <div className="p-1">
                {isLoading && actions.length === 0 ? (
                    <div className="flex justify-center py-4">
                        <Spin size="small" />
                    </div>
                ) : !actions.length ? (
                    <div className="py-3 px-2 text-[11px] text-slate-500">No actions found</div>
                ) : (
                    <>
                        {actions.map((action, index) => {
                            const toolSlug = buildToolSlug(
                                providerKey,
                                integrationKey,
                                action.key,
                                connectionSlug,
                            )
                            const isSelected = selectedToolNames.has(toolSlug)
                            const isPending = pendingActionKeys.has(action.key)
                            return (
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
                                        disabled={isPending}
                                        className={clsx(
                                            "!flex !h-[28px] !items-center !justify-between !text-left !py-[5px] !px-2",
                                            isSelected
                                                ? "!bg-blue-50 hover:!bg-blue-100"
                                                : "hover:!bg-slate-50",
                                            isPending && "opacity-70",
                                        )}
                                        onClick={() => handleActionClick(action.key, action.name)}
                                    >
                                        <span className="text-slate-900 text-xs truncate">
                                            {action.name}
                                        </span>
                                        {isPending ? (
                                            <Spin size="small" />
                                        ) : (
                                            isSelected && (
                                                <Check
                                                    size={14}
                                                    weight="bold"
                                                    className="text-blue-500 shrink-0"
                                                />
                                            )
                                        )}
                                    </Button>
                                    <div className="mx-2 h-px bg-slate-100" />
                                </React.Fragment>
                            )
                        })}

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
                                    className="text-[11px] text-slate-500"
                                    onClick={requestMore}
                                >
                                    Load more
                                </Button>
                            </div>
                        )}
                        <div className="text-[10px] text-slate-400 px-2 pb-1">
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
                "!flex !h-[28px] !items-center !justify-start !gap-1.5 !py-[5px] !px-1.5 !text-left",
                isHovered ? "!bg-blue-50" : "hover:!bg-slate-50",
            )}
        >
            <span className="flex h-4 w-4 items-center justify-center shrink-0">
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
                    <span className="h-4 w-4 rounded bg-slate-100 shrink-0" />
                )}
            </span>
            <Typography.Text className="flex-1 text-slate-900 text-xs leading-5 truncate">
                <span className="capitalize">{connection.integration_key.replace(/_/g, " ")}</span>
                <span className="text-slate-300 mx-1">/</span>
                <span className="text-slate-500">{connection.slug}</span>
            </Typography.Text>
            <CaretRight size={10} className="text-slate-300 shrink-0" />
        </Button>
    )
}

const ActionsOutputRenderer: React.FC<Props> = ({variantId, compoundKey, viewOnly}) => {
    const addNewMessage = useSetAtom(addPromptMessageMutationAtomFamily(compoundKey))
    const addNewTool = useSetAtom(addPromptToolMutationAtomFamily(compoundKey))
    const removeTool = useSetAtom(removePromptToolByNameAtomFamily(compoundKey))
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [builtinActionsSearch, setBuiltinActionsSearch] = useState("")
    const [hoveredKey, setHoveredKey] = useState<string | null>(null)
    const [leftPanelHeight, setLeftPanelHeight] = useState<number | undefined>(undefined)
    const leftPanelRef = useRef<HTMLDivElement>(null)
    const rightPanelRef = useRef<HTMLDivElement>(null)
    const removedToolPayloadCacheRef = useRef<Map<string, Record<string, any>>>(new Map())

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

    // Derive the set of already-added tool identifiers for toggle/checkmark display.
    // Function tools use function.name; builtin (non-function) tools fall back to __tool (toolCode).
    const selectedToolNames = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        const llm = getLLMConfig(item)
        const toolsArr = llm?.tools?.value
        if (!Array.isArray(toolsArr)) return new Set<string>()
        return new Set<string>(
            toolsArr.flatMap((t: any) => [t?.value?.function?.name, t?.__tool]).filter(Boolean),
        )
    }, [prompts, promptId])

    const selectedToolPayloadByName = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        const llm = getLLMConfig(item)
        const toolsArr = llm?.tools?.value
        const payloadByName = new Map<string, Record<string, any>>()
        if (!Array.isArray(toolsArr)) return payloadByName

        for (const tool of toolsArr) {
            const name = tool?.value?.function?.name
            if (name && tool?.value) {
                payloadByName.set(name, tool.value)
            }
        }

        return payloadByName
    }, [prompts, promptId])

    const hasBuiltin = filteredToolGroups.length > 0
    const hasComposio = isToolsEnabled()

    const closeDropdown = useCallback(() => {
        setIsDropdownOpen(false)
        setSearchTerm("")
        setBuiltinActionsSearch("")
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
            // For inline/custom tools, close the dropdown (they need editor focus)
            if (!params?.payload || params?.source === "inline") {
                addNewTool(params)
                closeDropdown()
                return
            }

            // For builtin tools, toggle: if already selected, remove; otherwise add.
            // Function tools use function.name; builtin (non-function) tools fall back to toolCode.
            const toolName = params.payload?.function?.name ?? params.toolCode
            if (toolName && selectedToolNames.has(toolName)) {
                const existingPayload = selectedToolPayloadByName.get(toolName)
                if (existingPayload) {
                    removedToolPayloadCacheRef.current.set(toolName, existingPayload)
                }
                removeTool(toolName)
            } else {
                const payload =
                    (toolName && removedToolPayloadCacheRef.current.get(toolName)) || params.payload

                if (toolName) {
                    removedToolPayloadCacheRef.current.delete(toolName)
                }

                addNewTool({...params, payload})
            }
        },
        [addNewTool, removeTool, closeDropdown, selectedToolNames, selectedToolPayloadByName],
    )

    const handleComposioActionAdd = useCallback(
        async ({
            providerKey,
            integrationKey,
            integrationName,
            connectionSlug,
            actionKey,
            actionName,
        }: ComposioActionSelectParams) => {
            const toolName = buildToolSlug(providerKey, integrationKey, actionKey, connectionSlug)

            // Toggle: if already selected, remove; otherwise fetch + add
            if (toolName && selectedToolNames.has(toolName)) {
                removeTool(toolName)
                return
            }

            let payload: Record<string, unknown>
            try {
                const detail = await fetchActionDetail(providerKey, integrationKey, actionKey)
                const action = detail.action
                payload = {
                    type: "function",
                    function: {
                        name: toolName,
                        description: action?.description ?? actionName,
                        parameters: getActionInputSchema(action?.schemas?.inputs),
                    },
                }
            } catch {
                message.error("Failed to load action details. Please try again.")
                return
            }

            addNewTool({
                source: "builtin",
                providerKey,
                providerLabel: integrationName,
                toolCode: `${connectionSlug}/${actionKey}`,
                toolLabel: actionName,
                payload,
            })
        },
        [addNewTool, removeTool, selectedToolNames],
    )

    // Derive right-panel content from hoveredKey
    const hoveredBuiltinGroup = hoveredKey?.startsWith("builtin:")
        ? filteredToolGroups.find((g) => g.key === hoveredKey.slice("builtin:".length))
        : null
    const hoveredConnection = hoveredKey?.startsWith("composio:")
        ? connections.find((c) => c.id === hoveredKey.slice("composio:".length))
        : null
    const showRightPanel = !!(hoveredBuiltinGroup || hoveredConnection)
    const filteredHoveredBuiltinTools = useMemo(() => {
        if (!hoveredBuiltinGroup) return []

        const normalizedTerm = builtinActionsSearch.trim().toLowerCase()
        if (!normalizedTerm) return hoveredBuiltinGroup.tools

        return hoveredBuiltinGroup.tools.filter(
            ({code, label}) =>
                code.toLowerCase().includes(normalizedTerm) ||
                label.toLowerCase().includes(normalizedTerm),
        )
    }, [hoveredBuiltinGroup, builtinActionsSearch])

    useEffect(() => {
        setBuiltinActionsSearch("")
    }, [hoveredBuiltinGroup?.key])

    const dropdownContent = (
        <div
            className="flex items-start bg-white rounded-lg shadow-lg overflow-hidden"
            onMouseLeave={() => setHoveredKey(null)}
        >
            {/* Left panel */}
            <div ref={leftPanelRef} className="w-[220px] flex flex-col shrink-0">
                <div className="max-h-80 overflow-y-auto overscroll-contain flex flex-col">
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
                                prefix={<MagnifyingGlass size={16} className="text-slate-400" />}
                                className="flex-1 !shadow-none !outline-none !border-none focus:!shadow-none focus:!outline-none focus:!border-none"
                            />
                        </div>
                        <div className="h-px bg-slate-100" />
                    </div>

                    <div className="p-1">
                        {/* Provider tools section */}
                        {hasBuiltin && (
                            <div className="flex flex-col">
                                <div className="flex items-center gap-1.5 py-[5px] px-1.5">
                                    <Sparkle
                                        size={12}
                                        weight="fill"
                                        className="text-slate-600 shrink-0"
                                    />
                                    <Typography.Text className="text-slate-600 text-xs font-medium">
                                        Built-in tools
                                    </Typography.Text>
                                </div>
                                {filteredToolGroups.map(({key, label, Icon}) => (
                                    <Button
                                        key={key}
                                        type="text"
                                        block
                                        onMouseEnter={() => handleRowHover(`builtin:${key}`)}
                                        className={clsx(
                                            "!flex !h-[28px] !items-center !justify-start !gap-1.5 !py-[5px] !px-1.5 !text-left",
                                            hoveredKey === `builtin:${key}`
                                                ? "!bg-blue-50"
                                                : "hover:!bg-slate-50",
                                        )}
                                    >
                                        {Icon ? (
                                            <span className="flex h-4 w-4 items-center justify-center shrink-0">
                                                <Icon className="h-4 w-4 text-slate-500" />
                                            </span>
                                        ) : (
                                            <span className="h-4 w-4 shrink-0" />
                                        )}
                                        <Typography.Text className="flex-1 text-slate-900 text-xs leading-5">
                                            {label}
                                        </Typography.Text>
                                        <CaretRight size={10} className="text-slate-300 shrink-0" />
                                    </Button>
                                ))}
                            </div>
                        )}

                        {/* Third-party integrations section */}
                        {hasComposio && (
                            <>
                                {hasBuiltin && (
                                    <Divider className="my-1" orientation="horizontal" />
                                )}
                                <div
                                    className="flex items-center justify-between py-[5px] px-1.5 cursor-pointer hover:bg-slate-50 rounded"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setIsDropdownOpen(false)
                                        setCatalogOpen(true)
                                    }}
                                >
                                    <div className="flex items-center gap-1.5">
                                        <Plugs
                                            size={12}
                                            weight="fill"
                                            className="text-slate-600 shrink-0"
                                        />
                                        <Typography.Text className="text-slate-600 text-xs font-medium">
                                            Third-party tools
                                        </Typography.Text>
                                    </div>
                                    <Plus size={12} className="text-slate-500 shrink-0" />
                                </div>
                                {connectionsLoading ? (
                                    <div className="flex justify-center py-2">
                                        <Spin size="small" />
                                    </div>
                                ) : filteredConnections.length === 0 ? (
                                    <Typography.Text
                                        type="secondary"
                                        className="text-xs px-1.5 py-1"
                                    >
                                        No integrations connected yet
                                    </Typography.Text>
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

                        {/* Custom tools section */}
                        {(hasBuiltin || hasComposio) && (
                            <Divider className="my-1" orientation="horizontal" />
                        )}
                        <div
                            className="flex items-center justify-between py-[5px] px-1.5 cursor-pointer hover:bg-slate-50 rounded"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleAddTool({source: "inline"})
                            }}
                        >
                            <div className="flex items-center gap-1.5">
                                <Code size={12} weight="bold" className="text-slate-600 shrink-0" />
                                <Typography.Text className="text-slate-600 text-xs font-medium">
                                    Custom tools
                                </Typography.Text>
                            </div>
                            <Plus size={12} className="text-slate-500 shrink-0" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Right panel: actions on hover — height locked to left panel */}
            {showRightPanel && (
                <>
                    <div className="w-px self-stretch shrink-0 bg-slate-200 dark:bg-slate-700" />
                    <div
                        ref={rightPanelRef}
                        className="w-[220px] overflow-y-auto overscroll-contain flex flex-col shrink-0"
                        style={leftPanelHeight ? {height: leftPanelHeight} : undefined}
                    >
                        {hoveredBuiltinGroup && (
                            <div className="flex flex-col min-h-0">
                                <div className="sticky top-0 z-10 bg-white">
                                    <div className="p-2">
                                        <Input
                                            allowClear
                                            variant="borderless"
                                            value={builtinActionsSearch}
                                            placeholder="Search actions"
                                            onChange={(event) =>
                                                setBuiltinActionsSearch(event.target.value)
                                            }
                                            onClear={() => setBuiltinActionsSearch("")}
                                            prefix={
                                                <MagnifyingGlass
                                                    size={14}
                                                    className="text-slate-400"
                                                />
                                            }
                                            className="flex-1 !shadow-none !outline-none !border-none focus:!shadow-none focus:!outline-none focus:!border-none"
                                        />
                                    </div>
                                    <div className="h-px bg-slate-100" />
                                </div>

                                <div className="p-1">
                                    {!filteredHoveredBuiltinTools.length ? (
                                        <div className="py-3 px-2 text-[11px] text-slate-500">
                                            No actions found
                                        </div>
                                    ) : (
                                        filteredHoveredBuiltinTools.map(
                                            ({code, label: toolLabel, payload}) => {
                                                const toolName = payload?.function?.name ?? code
                                                const isSelected = !!(
                                                    toolName && selectedToolNames.has(toolName)
                                                )
                                                return (
                                                    <React.Fragment key={code}>
                                                        <Button
                                                            type="text"
                                                            block
                                                            className={clsx(
                                                                "!flex !h-[28px] !items-center !justify-between !text-left !py-[5px] !px-2",
                                                                isSelected
                                                                    ? "!bg-blue-50 hover:!bg-blue-100"
                                                                    : "hover:!bg-slate-50",
                                                            )}
                                                            onClick={() =>
                                                                handleAddTool({
                                                                    payload,
                                                                    source: "builtin",
                                                                    providerKey:
                                                                        hoveredBuiltinGroup.key,
                                                                    providerLabel:
                                                                        hoveredBuiltinGroup.label,
                                                                    toolCode: code,
                                                                    toolLabel,
                                                                })
                                                            }
                                                        >
                                                            <span className="text-slate-900 text-xs">
                                                                {toolLabel}
                                                            </span>
                                                            {isSelected && (
                                                                <Check
                                                                    size={14}
                                                                    weight="bold"
                                                                    className="text-blue-500 shrink-0"
                                                                />
                                                            )}
                                                        </Button>
                                                        <div className="mx-2 h-px bg-slate-100" />
                                                    </React.Fragment>
                                                )
                                            },
                                        )
                                    )}
                                </div>
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
                                selectedToolNames={selectedToolNames}
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
                                setBuiltinActionsSearch("")
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
                    <span className="text-slate-500 text-[12px] leading-[20px] block">
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
