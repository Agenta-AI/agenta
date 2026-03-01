/**
 * ToolSelectorPopover
 *
 * Dropdown for selecting tools to add to a prompt configuration.
 * Supports:
 * - Built-in tools (OpenAI / Anthropic / Google Gemini)
 * - Third-party gateway tools (connections + actions) when injected by OSS
 * - Custom inline function tools
 */

import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type RefObject,
} from "react"

import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {CaretRight, Check, Code, MagnifyingGlass, Plus, Sparkle} from "@phosphor-icons/react"
import {Button, Dropdown, Empty, Input, Spin, Typography} from "antd"
import clsx from "clsx"

import type {GatewayToolsBridge} from "../context"
import {useDrillInUI} from "../context"

import {TOOL_PROVIDERS_META, TOOL_SPECS, type ToolObj} from "./toolUtils"

// ============================================================================
// TYPES
// ============================================================================

interface ProviderToolItem {
    providerKey: string
    providerLabel: string
    toolCode: string
    toolLabel: string
    payloads: Record<string, unknown>[]
}

interface BuiltinProviderGroup {
    providerKey: string
    providerLabel: string
    tools: ProviderToolItem[]
}

type ActivePane =
    | {kind: "builtin"; providerKey: string}
    | {kind: "connection"; connectionId: string}
    | null

export interface ToolSelectionMeta {
    source: "builtin" | "custom" | "gateway"
    provider?: string
    providerLabel?: string
    toolCode?: string
    toolLabel?: string
    integrationKey?: string
    connectionSlug?: string
}

export interface ToolSelectorPopoverProps {
    /** Called when a tool is selected (either builtin, gateway, or custom) */
    onAddTool: (tool: ToolObj, meta?: ToolSelectionMeta) => void
    /** Remove function tool by name (used for custom/gateway toggle) */
    onRemoveTool?: (toolName: string) => void
    /** Remove a builtin tool payload (used for builtin toggle) */
    onRemoveBuiltinTool?: (tool: ToolObj) => void
    /** Selected function tool names for checkmarks (gateway/custom) */
    selectedToolNames?: Set<string>
    /** Current tools for builtin payload match + checkmark */
    selectedTools?: ToolObj[]
    /** Whether the control is disabled */
    disabled?: boolean
    /** Optional renderer for provider icons */
    renderProviderIcon?: (providerKey: string) => ReactNode
    /** Number of existing tools (for naming new custom tools) */
    existingToolCount?: number
    /** Optional gateway tools bridge (typically from DrillInUIContext) */
    gatewayTools?: GatewayToolsBridge
}

// ============================================================================
// HELPERS
// ============================================================================

function formatToolLabel(code: string): string {
    return code
        .split("_")
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ")
}

function buildProviderToolList(): ProviderToolItem[] {
    const items: ProviderToolItem[] = []
    for (const [providerKey, tools] of Object.entries(TOOL_SPECS)) {
        const providerMeta = TOOL_PROVIDERS_META[providerKey]
        const providerLabel = providerMeta?.label ?? providerKey
        for (const [toolCode, payloads] of Object.entries(tools)) {
            items.push({
                providerKey,
                providerLabel,
                toolCode,
                toolLabel: formatToolLabel(toolCode),
                payloads,
            })
        }
    }
    return items
}

function groupByProvider(items: ProviderToolItem[]): BuiltinProviderGroup[] {
    const groups: Record<string, {providerLabel: string; tools: ProviderToolItem[]}> = {}
    for (const item of items) {
        if (!groups[item.providerKey]) {
            groups[item.providerKey] = {providerLabel: item.providerLabel, tools: []}
        }
        groups[item.providerKey].tools.push(item)
    }
    return Object.entries(groups).map(([providerKey, group]) => ({
        providerKey,
        providerLabel: group.providerLabel,
        tools: group.tools,
    }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function matchesToolPayload(toolObj: ToolObj, payload: Record<string, unknown>): boolean {
    if (!isRecord(toolObj)) return false
    if (typeof payload.type === "string" && toolObj.type === payload.type) return true
    if (typeof payload.name === "string" && toolObj.name === payload.name) return true

    const payloadKeys = Object.keys(payload)
    if (
        payloadKeys.length === 1 &&
        payloadKeys[0] !== "type" &&
        payloadKeys[0] !== "name" &&
        payloadKeys[0] in toolObj
    ) {
        return true
    }

    return false
}

function normalizeFunctionParametersSchema(inputs: unknown): Record<string, unknown> {
    if (!isRecord(inputs)) {
        return {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
        }
    }

    const schema = {...inputs}
    if (schema.type !== "object") schema.type = "object"
    if (!isRecord(schema.properties)) schema.properties = {}
    if (!Array.isArray(schema.required)) schema.required = []
    if (typeof schema.additionalProperties !== "boolean") {
        schema.additionalProperties = false
    }
    return schema
}

function buildInlineFunctionTool(existingToolCount: number): ToolObj {
    return {
        type: "function",
        function: {
            name: `tool_${existingToolCount + 1}`,
            description: "",
            parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
            },
        },
    }
}

const ALL_PROVIDER_TOOLS = buildProviderToolList()
const BUILTIN_PROVIDER_GROUPS = groupByProvider(ALL_PROVIDER_TOOLS)
const EMPTY_SET = new Set<string>()

// ============================================================================
// COMPONENT HELPERS
// ============================================================================

function defaultRenderProviderIcon(providerKey: string): ReactNode {
    const Icon = getProviderIcon(providerKey)
    if (!Icon) return null
    return <Icon className="w-4 h-4" />
}

function SectionHeader({icon, title, right}: {icon: ReactNode; title: string; right?: ReactNode}) {
    return (
        <div className="flex items-center justify-between px-2 py-1">
            <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-zinc-500 flex items-center">{icon}</span>
                <Typography.Text className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {title}
                </Typography.Text>
            </div>
            {right}
        </div>
    )
}

function HoverableRow({
    active,
    onMouseEnter,
    left,
    right,
    onClick,
}: {
    active?: boolean
    onMouseEnter?: () => void
    left: ReactNode
    right?: ReactNode
    onClick?: () => void
}) {
    return (
        <button
            type="button"
            onMouseEnter={onMouseEnter}
            onFocus={onMouseEnter}
            onClick={onClick}
            className={clsx(
                "w-full border-none bg-transparent [font:inherit] text-left cursor-pointer",
                "flex items-center gap-2 px-2 py-1.5 rounded-md",
                active ? "bg-zinc-100" : "hover:bg-zinc-50",
            )}
        >
            <div className="min-w-0 flex-1">{left}</div>
            {right}
        </button>
    )
}

function GatewayConnectionRowWithHook({
    connection,
    active,
    onHover,
    useIntegrationInfo,
}: {
    connection: NonNullable<GatewayToolsBridge>["connections"][number]
    active: boolean
    onHover: () => void
    useIntegrationInfo: NonNullable<GatewayToolsBridge>["useIntegrationInfo"]
}) {
    const info = useIntegrationInfo(connection.integration_key)
    const label = info.name || connection.integration_key.replace(/_/g, " ")

    return (
        <HoverableRow
            active={active}
            onMouseEnter={onHover}
            left={
                <div className="flex items-center gap-2 min-w-0">
                    {info.logo ? (
                        <img
                            src={info.logo}
                            alt={label}
                            className="w-4 h-4 rounded object-contain shrink-0"
                        />
                    ) : (
                        <div className="w-4 h-4 rounded bg-zinc-100 shrink-0" />
                    )}
                    <div className="min-w-0 flex flex-col leading-tight">
                        <span className="text-xs truncate">{label}</span>
                        <span className="text-[10px] text-zinc-400 truncate">
                            {connection.slug}
                        </span>
                    </div>
                </div>
            }
            right={<CaretRight size={12} className="text-zinc-400 shrink-0" />}
        />
    )
}

function GatewayConnectionRowFallback({
    connection,
    active,
    onHover,
    renderIntegrationInfo,
}: {
    connection: NonNullable<GatewayToolsBridge>["connections"][number]
    active: boolean
    onHover: () => void
    renderIntegrationInfo?: NonNullable<GatewayToolsBridge>["renderIntegrationInfo"]
}) {
    const info = renderIntegrationInfo?.(connection.integration_key) ?? null
    const label = info?.name || connection.integration_key.replace(/_/g, " ")

    return (
        <HoverableRow
            active={active}
            onMouseEnter={onHover}
            left={
                <div className="flex items-center gap-2 min-w-0">
                    {info?.logo ? (
                        <img
                            src={info.logo}
                            alt={label}
                            className="w-4 h-4 rounded object-contain shrink-0"
                        />
                    ) : (
                        <div className="w-4 h-4 rounded bg-zinc-100 shrink-0" />
                    )}
                    <div className="min-w-0 flex flex-col leading-tight">
                        <span className="text-xs truncate">{label}</span>
                        <span className="text-[10px] text-zinc-400 truncate">
                            {connection.slug}
                        </span>
                    </div>
                </div>
            }
            right={<CaretRight size={12} className="text-zinc-400 shrink-0" />}
        />
    )
}

function VisibilitySentinel({
    rootRef,
    enabled,
    onVisible,
}: {
    rootRef: RefObject<HTMLDivElement | null>
    enabled: boolean
    onVisible: () => void
}) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!enabled) return
        const node = ref.current
        if (!node) return

        const root = rootRef.current
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    onVisible()
                }
            },
            {
                root,
                threshold: 0.1,
            },
        )

        observer.observe(node)
        return () => observer.disconnect()
    }, [enabled, onVisible, rootRef])

    return <div ref={ref} className="h-2 w-full" />
}

function BuiltinToolsPane({
    provider,
    rightSearch,
    onRightSearchChange,
    selectedTools,
    onAddTool,
    onRemoveBuiltinTool,
}: {
    provider: BuiltinProviderGroup
    rightSearch: string
    onRightSearchChange: (value: string) => void
    selectedTools: ToolObj[]
    onAddTool: ToolSelectorPopoverProps["onAddTool"]
    onRemoveBuiltinTool?: ToolSelectorPopoverProps["onRemoveBuiltinTool"]
}) {
    const filteredTools = useMemo(() => {
        const q = rightSearch.trim().toLowerCase()
        if (!q) return provider.tools
        return provider.tools.filter(
            (tool) =>
                tool.toolLabel.toLowerCase().includes(q) || tool.toolCode.toLowerCase().includes(q),
        )
    }, [provider.tools, rightSearch])

    const isSelected = useCallback(
        (tool: ProviderToolItem) => {
            return selectedTools.some((selected) =>
                tool.payloads.some((payload) => matchesToolPayload(selected, payload)),
            )
        },
        [selectedTools],
    )

    const handleToggle = useCallback(
        (tool: ProviderToolItem) => {
            const selected = isSelected(tool)
            const payload = (tool.payloads[0] ?? {}) as ToolObj

            if (selected && onRemoveBuiltinTool) {
                onRemoveBuiltinTool(payload)
                return
            }

            if (!selected) {
                onAddTool(payload, {
                    source: "builtin",
                    provider: tool.providerKey,
                    toolCode: tool.toolCode,
                })
            }
        },
        [isSelected, onAddTool, onRemoveBuiltinTool],
    )

    return (
        <div className="flex flex-col h-full">
            <div className="px-2 py-1.5 border-0 border-b border-solid border-zinc-100">
                <Input
                    size="small"
                    prefix={<MagnifyingGlass size={14} className="text-zinc-400" />}
                    placeholder={`Search ${provider.providerLabel} tools`}
                    value={rightSearch}
                    onChange={(e) => onRightSearchChange(e.target.value)}
                    allowClear
                />
            </div>

            <div className="flex-1 overflow-y-auto p-1">
                {filteredTools.map((tool) => {
                    const selected = isSelected(tool)
                    return (
                        <button
                            key={`${tool.providerKey}-${tool.toolCode}`}
                            type="button"
                            onClick={() => handleToggle(tool)}
                            className={clsx(
                                "w-full border-none bg-transparent [font:inherit] cursor-pointer",
                                "flex items-center gap-2 px-2 py-1.5 rounded-md text-left",
                                selected ? "bg-zinc-100" : "hover:bg-zinc-50",
                            )}
                        >
                            <span className="min-w-0 flex-1 text-xs truncate">
                                {tool.toolLabel}
                            </span>
                            {selected && <Check size={12} className="text-blue-600 shrink-0" />}
                        </button>
                    )
                })}

                {filteredTools.length === 0 && (
                    <div className="py-6">
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={<span className="text-xs">No tools found</span>}
                        />
                    </div>
                )}
            </div>
        </div>
    )
}

function GatewayActionsPaneHeaderWithHook({
    connection,
    useIntegrationInfo,
}: {
    connection: NonNullable<GatewayToolsBridge>["connections"][number]
    useIntegrationInfo: NonNullable<GatewayToolsBridge>["useIntegrationInfo"]
}) {
    const info = useIntegrationInfo(connection.integration_key)
    const label = info.name || connection.integration_key.replace(/_/g, " ")
    return (
        <div className="px-2 pt-1 pb-0.5 text-[11px] text-zinc-500 truncate">
            {label} / {connection.slug}
        </div>
    )
}

function GatewayActionsPaneHeaderFallback({
    connection,
    renderIntegrationInfo,
}: {
    connection: NonNullable<GatewayToolsBridge>["connections"][number]
    renderIntegrationInfo?: NonNullable<GatewayToolsBridge>["renderIntegrationInfo"]
}) {
    const info = renderIntegrationInfo?.(connection.integration_key)
    const label = info?.name || connection.integration_key.replace(/_/g, " ")
    return (
        <div className="px-2 pt-1 pb-0.5 text-[11px] text-zinc-500 truncate">
            {label} / {connection.slug}
        </div>
    )
}

function GatewayActionsPane({
    gatewayTools,
    connection,
    rightSearch,
    onRightSearchChange,
    selectedToolNames,
    onAddTool,
    onRemoveTool,
    showMessage,
}: {
    gatewayTools: GatewayToolsBridge
    connection: NonNullable<GatewayToolsBridge>["connections"][number]
    rightSearch: string
    onRightSearchChange: (value: string) => void
    selectedToolNames: Set<string>
    onAddTool: ToolSelectorPopoverProps["onAddTool"]
    onRemoveTool?: ToolSelectorPopoverProps["onRemoveTool"]
    showMessage?: (content: string, type?: "success" | "error" | "info") => void
}) {
    const {
        actions,
        total,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        requestMore,
        setSearch,
        prefetchThreshold,
    } = gatewayTools.useActions(connection.integration_key)

    const [pendingActionKey, setPendingActionKey] = useState<string | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setSearch(rightSearch)
    }, [rightSearch, setSearch])

    useEffect(() => {
        return () => {
            setSearch("")
        }
    }, [setSearch])

    const sentinelIndex = useMemo(
        () => Math.max(0, actions.length - prefetchThreshold),
        [actions.length, prefetchThreshold],
    )

    const handleToggleAction = useCallback(
        async (action: {key: string; name: string}) => {
            const slug = gatewayTools.buildToolSlug(
                connection.provider_key,
                connection.integration_key,
                action.key,
                connection.slug,
            )

            if (selectedToolNames.has(slug)) {
                onRemoveTool?.(slug)
                return
            }

            try {
                setPendingActionKey(action.key)
                const detail = await gatewayTools.fetchActionDetail(
                    connection.provider_key,
                    connection.integration_key,
                    action.key,
                )
                const parameters = normalizeFunctionParametersSchema(detail.action?.schemas?.inputs)
                const newTool: ToolObj = {
                    type: "function",
                    function: {
                        name: slug,
                        description: detail.action?.description || action.name,
                        parameters,
                    },
                }
                onAddTool(newTool, {
                    source: "gateway",
                    provider: connection.provider_key,
                    toolCode: action.key,
                    toolLabel: action.key,
                    integrationKey: connection.integration_key,
                    connectionSlug: connection.slug,
                })
            } catch (error) {
                console.error("Failed to add gateway tool action", error)
                showMessage?.("Failed to load tool action schema", "error")
            } finally {
                setPendingActionKey(null)
            }
        },
        [connection, gatewayTools, onAddTool, onRemoveTool, selectedToolNames, showMessage],
    )

    return (
        <div className="flex flex-col h-full">
            {gatewayTools.useIntegrationInfo ? (
                <GatewayActionsPaneHeaderWithHook
                    connection={connection}
                    useIntegrationInfo={gatewayTools.useIntegrationInfo}
                />
            ) : (
                <GatewayActionsPaneHeaderFallback
                    connection={connection}
                    renderIntegrationInfo={gatewayTools.renderIntegrationInfo}
                />
            )}

            <div className="px-2 py-1 border-0 border-b border-solid border-zinc-100">
                <Input
                    size="small"
                    prefix={<MagnifyingGlass size={14} className="text-zinc-400" />}
                    placeholder="Search actions"
                    value={rightSearch}
                    onChange={(e) => onRightSearchChange(e.target.value)}
                    allowClear
                />
                <div className="mt-1 text-[10px] text-zinc-400">{total} actions</div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-1">
                {isLoading && actions.length === 0 ? (
                    <div className="flex items-center justify-center py-6">
                        <Spin size="small" />
                    </div>
                ) : actions.length === 0 ? (
                    <div className="py-6">
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={<span className="text-xs">No actions found</span>}
                        />
                    </div>
                ) : (
                    <div className="flex flex-col">
                        {actions.map((action, index) => {
                            const slug = gatewayTools.buildToolSlug(
                                connection.provider_key,
                                connection.integration_key,
                                action.key,
                                connection.slug,
                            )
                            const selected = selectedToolNames.has(slug)
                            const isPending = pendingActionKey === action.key

                            return (
                                <div key={action.key}>
                                    {index === sentinelIndex && (
                                        <VisibilitySentinel
                                            rootRef={scrollRef}
                                            enabled={hasNextPage && !isFetchingNextPage}
                                            onVisible={requestMore}
                                        />
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => void handleToggleAction(action)}
                                        disabled={isPending}
                                        className={clsx(
                                            "w-full border-none bg-transparent [font:inherit]",
                                            "flex items-center gap-2 px-2 py-1.5 rounded-md text-left cursor-pointer",
                                            isPending && "opacity-70 cursor-wait",
                                            selected ? "bg-zinc-100" : "hover:bg-zinc-50",
                                        )}
                                    >
                                        <span className="min-w-0 flex-1 flex flex-col leading-tight">
                                            <span className="text-xs truncate">{action.name}</span>
                                            <span className="text-[10px] text-zinc-400 truncate">
                                                {action.key}
                                            </span>
                                        </span>
                                        {isPending ? (
                                            <Spin size="small" />
                                        ) : selected ? (
                                            <Check size={12} className="text-blue-600 shrink-0" />
                                        ) : null}
                                    </button>
                                </div>
                            )
                        })}

                        <VisibilitySentinel
                            rootRef={scrollRef}
                            enabled={hasNextPage && !isFetchingNextPage}
                            onVisible={requestMore}
                        />

                        {isFetchingNextPage && (
                            <div className="flex items-center justify-center py-2">
                                <Spin size="small" />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ToolSelectorPopover = memo(function ToolSelectorPopover({
    onAddTool,
    onRemoveTool,
    onRemoveBuiltinTool,
    selectedToolNames,
    selectedTools,
    disabled = false,
    renderProviderIcon,
    existingToolCount = 0,
    gatewayTools: gatewayToolsProp,
}: ToolSelectorPopoverProps) {
    const {showMessage, gatewayTools: gatewayToolsFromContext} = useDrillInUI()

    const effectiveRenderProviderIcon = renderProviderIcon ?? defaultRenderProviderIcon
    const gatewayTools = gatewayToolsProp ?? gatewayToolsFromContext
    const effectiveSelectedToolNames = selectedToolNames ?? EMPTY_SET
    const effectiveSelectedTools = selectedTools ?? []

    const [open, setOpen] = useState(false)
    const [leftSearch, setLeftSearch] = useState("")
    const [rightSearch, setRightSearch] = useState("")
    const [activePane, setActivePane] = useState<ActivePane>(null)
    const [leftPanelHeight, setLeftPanelHeight] = useState<number | null>(null)
    const leftPanelRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = leftPanelRef.current
        if (!el) return

        const updateHeight = () => setLeftPanelHeight(el.offsetHeight)
        updateHeight()

        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(() => updateHeight())
            observer.observe(el)
            return () => observer.disconnect()
        }

        window.addEventListener("resize", updateHeight)
        return () => window.removeEventListener("resize", updateHeight)
    }, [open, leftSearch, gatewayTools?.enabled, gatewayTools?.connections.length])

    useEffect(() => {
        setRightSearch("")
    }, [activePane])

    const builtinProviderGroups = useMemo(() => {
        const q = leftSearch.trim().toLowerCase()
        if (!q) return BUILTIN_PROVIDER_GROUPS
        return BUILTIN_PROVIDER_GROUPS.filter((group) => {
            if (group.providerLabel.toLowerCase().includes(q)) return true
            return group.tools.some(
                (tool) =>
                    tool.toolLabel.toLowerCase().includes(q) ||
                    tool.toolCode.toLowerCase().includes(q),
            )
        })
    }, [leftSearch])

    const gatewayConnections = useMemo(() => {
        if (!gatewayTools?.enabled) return []
        const q = leftSearch.trim().toLowerCase()
        if (!q) return gatewayTools.connections
        return gatewayTools.connections.filter((connection) =>
            [connection.integration_key, connection.slug, connection.name, connection.provider_key]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(q)),
        )
    }, [gatewayTools, leftSearch])

    const activeBuiltinProvider = useMemo(() => {
        if (!activePane || activePane.kind !== "builtin") return null
        return (
            BUILTIN_PROVIDER_GROUPS.find((group) => group.providerKey === activePane.providerKey) ??
            null
        )
    }, [activePane])

    const activeGatewayConnection = useMemo(() => {
        if (!activePane || activePane.kind !== "connection") return null
        return gatewayTools?.connections.find((c) => c.id === activePane.connectionId) ?? null
    }, [activePane, gatewayTools?.connections])

    const resetAndClose = useCallback(() => {
        setOpen(false)
        setLeftSearch("")
        setRightSearch("")
        setActivePane(null)
    }, [])

    const handleCreateInline = useCallback(() => {
        onAddTool(buildInlineFunctionTool(existingToolCount), {source: "custom"})
        resetAndClose()
    }, [existingToolCount, onAddTool, resetAndClose])

    const content = (
        <div className="flex min-w-[460px] bg-white rounded-lg overflow-hidden border border-zinc-100 shadow-sm">
            <div
                ref={leftPanelRef}
                className="w-[232px] border-0 border-r border-solid border-zinc-100"
            >
                <div className="px-2 py-2 border-0 border-b border-solid border-zinc-100">
                    <Input
                        size="small"
                        value={leftSearch}
                        onChange={(e) => setLeftSearch(e.target.value)}
                        prefix={<MagnifyingGlass size={14} className="text-zinc-400" />}
                        placeholder="Search integrations"
                        allowClear
                    />
                </div>

                <div className="max-h-[360px] overflow-y-auto p-1 flex flex-col gap-1">
                    <div>
                        <SectionHeader icon={<Sparkle size={12} />} title="Built-in tools" />
                        <div className="flex flex-col gap-0.5">
                            {builtinProviderGroups.map((group) => (
                                <HoverableRow
                                    key={group.providerKey}
                                    active={
                                        activePane?.kind === "builtin" &&
                                        activePane.providerKey === group.providerKey
                                    }
                                    onMouseEnter={() =>
                                        setActivePane({
                                            kind: "builtin",
                                            providerKey: group.providerKey,
                                        })
                                    }
                                    left={
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="flex h-4 w-4 items-center justify-center text-zinc-600 shrink-0">
                                                {effectiveRenderProviderIcon(group.providerKey)}
                                            </span>
                                            <span className="text-xs truncate">
                                                {group.providerLabel}
                                            </span>
                                        </div>
                                    }
                                    right={
                                        <CaretRight size={12} className="text-zinc-400 shrink-0" />
                                    }
                                />
                            ))}

                            {builtinProviderGroups.length === 0 && (
                                <div className="px-2 py-2 text-xs text-zinc-400">
                                    No built-in matches
                                </div>
                            )}
                        </div>
                    </div>

                    {gatewayTools?.enabled && (
                        <div>
                            <SectionHeader
                                icon={<Plus size={12} />}
                                title="Third-party tools"
                                right={
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<Plus size={12} />}
                                        onClick={() => gatewayTools.onOpenCatalog()}
                                        className="!h-5 !px-1"
                                    />
                                }
                            />
                            <div className="flex flex-col gap-0.5">
                                {gatewayTools.connectionsLoading &&
                                gatewayConnections.length === 0 ? (
                                    <div className="flex items-center justify-center py-3">
                                        <Spin size="small" />
                                    </div>
                                ) : gatewayConnections.length === 0 ? (
                                    <div className="px-2 py-2 text-xs text-zinc-400">
                                        No connected tools
                                    </div>
                                ) : (
                                    gatewayConnections.map((connection) => {
                                        const isActive =
                                            activePane?.kind === "connection" &&
                                            activePane.connectionId === connection.id

                                        if (gatewayTools.useIntegrationInfo) {
                                            return (
                                                <GatewayConnectionRowWithHook
                                                    key={connection.id}
                                                    connection={connection}
                                                    active={isActive}
                                                    onHover={() =>
                                                        setActivePane({
                                                            kind: "connection",
                                                            connectionId: connection.id,
                                                        })
                                                    }
                                                    useIntegrationInfo={
                                                        gatewayTools.useIntegrationInfo
                                                    }
                                                />
                                            )
                                        }

                                        return (
                                            <GatewayConnectionRowFallback
                                                key={connection.id}
                                                connection={connection}
                                                active={isActive}
                                                onHover={() =>
                                                    setActivePane({
                                                        kind: "connection",
                                                        connectionId: connection.id,
                                                    })
                                                }
                                                renderIntegrationInfo={
                                                    gatewayTools.renderIntegrationInfo
                                                }
                                            />
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    )}

                    <div>
                        <SectionHeader
                            icon={<Code size={12} />}
                            title="Custom tools"
                            right={
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<Plus size={12} />}
                                    onClick={handleCreateInline}
                                    className="!h-5 !px-1"
                                />
                            }
                        />
                        <div className="px-2 pb-1 text-[11px] text-zinc-400">
                            Create in-line function tool
                        </div>
                    </div>
                </div>
            </div>

            <div
                className="w-[232px] bg-white"
                style={leftPanelHeight ? {height: leftPanelHeight} : undefined}
            >
                {activeBuiltinProvider ? (
                    <BuiltinToolsPane
                        provider={activeBuiltinProvider}
                        rightSearch={rightSearch}
                        onRightSearchChange={setRightSearch}
                        selectedTools={effectiveSelectedTools}
                        onAddTool={onAddTool}
                        onRemoveBuiltinTool={onRemoveBuiltinTool}
                    />
                ) : gatewayTools?.enabled && activeGatewayConnection ? (
                    <GatewayActionsPane
                        gatewayTools={gatewayTools}
                        connection={activeGatewayConnection}
                        rightSearch={rightSearch}
                        onRightSearchChange={setRightSearch}
                        selectedToolNames={effectiveSelectedToolNames}
                        onAddTool={onAddTool}
                        onRemoveTool={onRemoveTool}
                        showMessage={showMessage}
                    />
                ) : (
                    <div className="h-full flex items-center justify-center px-4 text-center">
                        <Typography.Text type="secondary" className="text-xs">
                            Hover a provider or connected integration to browse tools.
                        </Typography.Text>
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <Dropdown
            open={!disabled && open}
            onOpenChange={(nextOpen) => {
                if (disabled) return
                if (!nextOpen) {
                    resetAndClose()
                    return
                }
                setOpen(true)
            }}
            trigger={["click"]}
            placement="bottomLeft"
            arrow={false}
            menu={{items: []}}
            popupRender={() => content}
            overlayClassName="[&_.ant-dropdown-menu]:hidden [&_.ant-dropdown]:p-0"
        >
            <Button
                variant="outlined"
                color="default"
                size="small"
                icon={<Plus size={14} />}
                disabled={disabled}
            >
                Tool
            </Button>
        </Dropdown>
    )
})
