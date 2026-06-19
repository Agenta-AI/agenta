/**
 * AgentConfigControl
 *
 * One composite control for the whole agent config, dispatched from
 * `x-ag-type: "agent_config"` / `x-ag-type-ref: "agent_config"` (see SchemaPropertyRenderer).
 * It reuses the existing controls rather than inventing new ones: the model selector
 * (GroupedChoiceControl), the tool picker (ToolSelectorPopover + ToolItemControl), the MCP
 * server editor (McpServerItemControl), enum selects (harness, sandbox, permission policy),
 * and a textarea (agents_md). The field shape is the `agent_config` catalog type generated
 * from the SDK model (AgentConfigSchema in agenta.sdk.utils.types); the agent service ships a
 * thin `x-ag-type-ref` the playground resolves and reads back (services/oss/src/agent).
 */
import {useCallback, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {Plus} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

import {EnumSelectControl} from "./EnumSelectControl"
import {GroupedChoiceControl} from "./GroupedChoiceControl"
import {McpServerItemControl} from "./McpServerItemControl"
import {TextInputControl} from "./TextInputControl"
import {ToolItemControl} from "./ToolItemControl"
import {ToolSelectorPopover, type ToolSelectionMeta} from "./ToolSelectorPopover"
import {type ToolObj} from "./toolUtils"

export interface AgentConfigControlProps {
    schema?: SchemaProperty | null
    label?: string
    value?: Record<string, unknown> | null
    onChange: (value: Record<string, unknown>) => void
    description?: string
    withTooltip?: boolean
    disabled?: boolean
    className?: string
}

/** Read the function name of a tool object (the gateway slug for Composio tools). */
function toolName(tool: unknown): string | undefined {
    if (!tool || typeof tool !== "object") return undefined
    const fn = (tool as Record<string, unknown>).function
    if (!fn || typeof fn !== "object") return undefined
    const name = (fn as Record<string, unknown>).name
    return typeof name === "string" ? name : undefined
}

function isBuiltinPayloadMatch(tool: unknown, payload: ToolObj): boolean {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false

    const toolObj = tool as Record<string, unknown>
    const payloadObj = payload as Record<string, unknown>

    if (typeof payloadObj.type === "string" && toolObj.type === payloadObj.type) return true
    if (typeof payloadObj.name === "string" && toolObj.name === payloadObj.name) return true

    const payloadKeys = Object.keys(payloadObj)
    return (
        payloadKeys.length === 1 &&
        payloadKeys[0] !== "type" &&
        payloadKeys[0] !== "name" &&
        payloadKeys[0] in toolObj
    )
}

export function AgentConfigControl({
    schema,
    value,
    onChange,
    withTooltip,
    disabled,
    className,
}: AgentConfigControlProps) {
    const {EditorProvider} = useDrillInUI()
    const config = (value ?? {}) as Record<string, unknown>
    const props = (schema?.properties ?? {}) as Record<string, SchemaProperty>

    // Update a single field of the agent config, leaving the rest intact.
    const setField = useCallback(
        (key: string, fieldValue: unknown) => onChange({...config, [key]: fieldValue}),
        [config, onChange],
    )

    // Tools live as a flat array on the agent config (the same tool-object shape the
    // prompt control uses, so the backend resolver parses them identically).
    const tools = useMemo(
        () => (Array.isArray(config.tools) ? (config.tools as unknown[]) : []),
        [config.tools],
    )
    const setTools = useCallback((next: unknown[]) => setField("tools", next), [setField])

    const handleAddTool = useCallback(
        (tool: ToolObj, meta?: ToolSelectionMeta) => {
            const next =
                meta && tool && typeof tool === "object" && !Array.isArray(tool)
                    ? {
                          ...(tool as Record<string, unknown>),
                          agenta_metadata: {
                              ...(((tool as Record<string, unknown>).agenta_metadata as
                                  | Record<string, unknown>
                                  | undefined) ?? {}),
                              ...meta,
                          },
                      }
                    : tool
            setTools([...tools, next])
        },
        [tools, setTools],
    )

    const handleToolChange = useCallback(
        (index: number, next: ToolObj) => {
            const updated = [...tools]
            updated[index] = next
            setTools(updated)
        },
        [tools, setTools],
    )

    const handleToolDelete = useCallback(
        (index: number) => setTools(tools.filter((_, i) => i !== index)),
        [tools, setTools],
    )

    const handleRemoveToolByName = useCallback(
        (name: string) => setTools(tools.filter((tool) => toolName(tool) !== name)),
        [tools, setTools],
    )

    const handleRemoveBuiltinTool = useCallback(
        (toolToRemove: ToolObj) => {
            let removed = false
            const updated = tools.filter((tool) => {
                if (removed) return true
                if (!isBuiltinPayloadMatch(tool, toolToRemove)) return true
                removed = true
                return false
            })
            if (removed) setTools(updated)
        },
        [tools, setTools],
    )

    const selectedToolNames = useMemo(
        () => new Set(tools.map(toolName).filter((n): n is string => Boolean(n))),
        [tools],
    )

    // MCP servers are a sibling of tools: a flat array on the agent config. Each entry is the
    // open McpServer shape (name + stdio command/args/env or remote url, secret names), edited
    // as JSON the backend resolver parses identically to `tools`.
    const mcpServers = useMemo(
        () => (Array.isArray(config.mcp_servers) ? (config.mcp_servers as unknown[]) : []),
        [config.mcp_servers],
    )
    const setMcpServers = useCallback(
        (next: unknown[]) => setField("mcp_servers", next),
        [setField],
    )
    const handleAddMcpServer = useCallback(
        () => setMcpServers([...mcpServers, {name: "", transport: "stdio", command: "", args: []}]),
        [mcpServers, setMcpServers],
    )
    const handleMcpServerChange = useCallback(
        (index: number, next: Record<string, unknown>) => {
            const updated = [...mcpServers]
            updated[index] = next
            setMcpServers(updated)
        },
        [mcpServers, setMcpServers],
    )
    const handleMcpServerDelete = useCallback(
        (index: number) => setMcpServers(mcpServers.filter((_, i) => i !== index)),
        [mcpServers, setMcpServers],
    )

    // ``agents_md`` is the catalog-schema field; ``instructions`` is read as a fallback so an
    // already-stored agent config (the legacy key) still populates the editor.
    const agentsMd =
        (config.agents_md as string | null | undefined) ??
        (config.instructions as string | null | undefined) ??
        null

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            <TextInputControl
                schema={props.agents_md}
                label="Instructions"
                value={agentsMd}
                onChange={(v) => setField("agents_md", v)}
                description={props.agents_md?.description as string | undefined}
                withTooltip={withTooltip}
                disabled={disabled}
                multiline
            />

            <GroupedChoiceControl
                schema={props.model}
                label="Model"
                value={(config.model as string | null) ?? null}
                onChange={(v) => setField("model", v)}
                withTooltip={withTooltip}
                disabled={disabled}
            />

            {/* Tools */}
            <div className="flex flex-col gap-2">
                {tools.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {tools.map((tool, index) => {
                            const control = (
                                <ToolItemControl
                                    key={`tool-${index}`}
                                    value={tool}
                                    onChange={(v) => handleToolChange(index, v)}
                                    onDelete={disabled ? undefined : () => handleToolDelete(index)}
                                    disabled={disabled}
                                />
                            )
                            return EditorProvider ? (
                                <EditorProvider
                                    key={`tool-editor-${index}`}
                                    codeOnly
                                    language="json"
                                    showToolbar={false}
                                    enableTokens={false}
                                    id={`agent-tool-editor-${index}`}
                                >
                                    {control}
                                </EditorProvider>
                            ) : (
                                control
                            )
                        })}
                    </div>
                )}
                {!disabled && (
                    <div>
                        <ToolSelectorPopover
                            onAddTool={handleAddTool}
                            onRemoveTool={handleRemoveToolByName}
                            onRemoveBuiltinTool={handleRemoveBuiltinTool}
                            selectedToolNames={selectedToolNames}
                            selectedTools={tools as ToolObj[]}
                            existingToolCount={tools.length}
                        />
                    </div>
                )}
            </div>

            {/* MCP servers */}
            <div className="flex flex-col gap-2">
                <Typography.Text className="text-sm font-medium">MCP servers</Typography.Text>
                {mcpServers.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {mcpServers.map((server, index) => {
                            const control = (
                                <McpServerItemControl
                                    key={`mcp-${index}`}
                                    value={server}
                                    onChange={(v) => handleMcpServerChange(index, v)}
                                    onDelete={
                                        disabled ? undefined : () => handleMcpServerDelete(index)
                                    }
                                    disabled={disabled}
                                />
                            )
                            return EditorProvider ? (
                                <EditorProvider
                                    key={`mcp-editor-${index}`}
                                    codeOnly
                                    language="json"
                                    showToolbar={false}
                                    enableTokens={false}
                                    id={`agent-mcp-editor-${index}`}
                                >
                                    {control}
                                </EditorProvider>
                            ) : (
                                control
                            )
                        })}
                    </div>
                )}
                {!disabled && (
                    <div>
                        <Button size="small" icon={<Plus size={14} />} onClick={handleAddMcpServer}>
                            Add MCP server
                        </Button>
                    </div>
                )}
            </div>

            <EnumSelectControl
                schema={props.harness}
                label="Harness"
                value={(config.harness as string | null) ?? null}
                onChange={(v) => setField("harness", v)}
                withTooltip={withTooltip}
                disabled={disabled}
            />

            <EnumSelectControl
                schema={props.sandbox}
                label="Sandbox"
                value={(config.sandbox as string | null) ?? null}
                onChange={(v) => setField("sandbox", v)}
                withTooltip={withTooltip}
                disabled={disabled}
            />

            <EnumSelectControl
                schema={props.permission_policy}
                label="Permission policy"
                value={(config.permission_policy as string | null) ?? null}
                onChange={(v) => setField("permission_policy", v)}
                withTooltip={withTooltip}
                disabled={disabled}
            />
        </div>
    )
}
