/**
 * ToolSelectorPopover
 *
 * Popover for selecting tools to add to a prompt configuration.
 * Shows provider-specific builtin tools grouped by provider (OpenAI, Anthropic, Google Gemini)
 * with search filtering and a "+ Create in-line" button for custom function tools.
 */

import {memo, useCallback, useMemo, useState} from "react"

import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {MagnifyingGlass, Plus} from "@phosphor-icons/react"
import {Button, Input, Popover} from "antd"

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

export interface ToolSelectorPopoverProps {
    /** Called when a tool is selected (either builtin or custom) */
    onAddTool: (
        tool: ToolObj,
        meta?: {source: string; provider?: string; toolCode?: string},
    ) => void
    /** Whether the control is disabled */
    disabled?: boolean
    /** Optional renderer for provider icons */
    renderProviderIcon?: (providerKey: string) => React.ReactNode
    /** Number of existing tools (for naming new custom tools) */
    existingToolCount?: number
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

const ALL_PROVIDER_TOOLS = buildProviderToolList()

// Group tools by provider for display
function groupByProvider(
    items: ProviderToolItem[],
): {providerKey: string; providerLabel: string; tools: ProviderToolItem[]}[] {
    const groups: Record<string, {providerLabel: string; tools: ProviderToolItem[]}> = {}
    for (const item of items) {
        if (!groups[item.providerKey]) {
            groups[item.providerKey] = {providerLabel: item.providerLabel, tools: []}
        }
        groups[item.providerKey].tools.push(item)
    }
    // Maintain stable order from TOOL_SPECS
    return Object.entries(groups).map(([providerKey, group]) => ({
        providerKey,
        ...group,
    }))
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Default provider icon renderer using getProviderIcon from @agenta/ui
 */
function defaultRenderProviderIcon(providerKey: string): React.ReactNode {
    const Icon = getProviderIcon(providerKey)
    if (!Icon) return null
    return <Icon className="w-4 h-4" />
}

export const ToolSelectorPopover = memo(function ToolSelectorPopover({
    onAddTool,
    disabled = false,
    renderProviderIcon,
    existingToolCount = 0,
}: ToolSelectorPopoverProps) {
    // Use prop if provided, otherwise use default
    const effectiveRenderProviderIcon = renderProviderIcon ?? defaultRenderProviderIcon

    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")

    const filteredTools = useMemo(() => {
        if (!search.trim()) return ALL_PROVIDER_TOOLS
        const q = search.toLowerCase()
        return ALL_PROVIDER_TOOLS.filter(
            (t) =>
                t.toolLabel.toLowerCase().includes(q) ||
                t.providerLabel.toLowerCase().includes(q) ||
                t.toolCode.toLowerCase().includes(q),
        )
    }, [search])

    const grouped = useMemo(() => groupByProvider(filteredTools), [filteredTools])

    const handleSelectBuiltin = useCallback(
        (item: ProviderToolItem) => {
            // Use the first payload as the tool value
            const payload = item.payloads[0] ?? {}
            onAddTool(payload as ToolObj, {
                source: "builtin",
                provider: item.providerKey,
                toolCode: item.toolCode,
            })
            setOpen(false)
            setSearch("")
        },
        [onAddTool],
    )

    const handleCreateInline = useCallback(() => {
        const newTool = {
            type: "function",
            function: {
                name: `tool_${existingToolCount + 1}`,
                description: "",
                parameters: {type: "object", properties: {}},
            },
        }
        onAddTool(newTool)
        setOpen(false)
        setSearch("")
    }, [onAddTool, existingToolCount])

    const content = (
        <div className="flex flex-col gap-2 min-w-[280px] max-h-[400px]">
            {/* Header: Search + Create in-line */}
            <div className="flex items-center gap-2">
                <Input
                    prefix={<MagnifyingGlass size={14} className="text-zinc-400" />}
                    placeholder="Search"
                    variant="borderless"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    allowClear
                    className="flex-1"
                />
                <Button
                    size="small"
                    type="primary"
                    icon={<Plus size={14} />}
                    onClick={handleCreateInline}
                >
                    Create in-line
                </Button>
            </div>

            {/* Provider tool list */}
            <div className="flex flex-col gap-1 overflow-y-auto max-h-[320px] -mx-1 px-1">
                {grouped.map((group) => (
                    <div key={group.providerKey} className="flex flex-col">
                        {/* Provider header */}
                        <div className="flex items-center gap-1.5 py-1.5 px-1">
                            {effectiveRenderProviderIcon && (
                                <span className="flex h-5 w-5 items-center justify-center">
                                    {effectiveRenderProviderIcon(group.providerKey)}
                                </span>
                            )}
                            <span className="font-medium text-zinc-700">{group.providerLabel}</span>
                        </div>

                        {/* Tool items */}
                        {group.tools.map((tool) => (
                            <button
                                key={`${tool.providerKey}-${tool.toolCode}`}
                                type="button"
                                className="flex items-center gap-2 py-1.5 px-3 text-left text-zinc-600 hover:bg-zinc-50 rounded cursor-pointer border-none bg-transparent w-full [font:inherit]"
                                onClick={() => handleSelectBuiltin(tool)}
                            >
                                <span className="text-zinc-400">•</span>
                                <span>{tool.toolLabel}</span>
                            </button>
                        ))}
                    </div>
                ))}

                {grouped.length === 0 && search.trim() && (
                    <div className="text-zinc-400 text-center py-3">
                        No tools match &quot;{search}&quot;
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <Popover
            open={!disabled && open}
            onOpenChange={disabled ? undefined : setOpen}
            trigger={["click"]}
            placement="bottomLeft"
            arrow={false}
            content={content}
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
        </Popover>
    )
})
