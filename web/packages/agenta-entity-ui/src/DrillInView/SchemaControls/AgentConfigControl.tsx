/**
 * AgentConfigControl
 *
 * One composite control for the whole agent config, dispatched from
 * `x-ag-type: "agent_config"` / `x-ag-type-ref: "agent_config"` (see SchemaPropertyRenderer).
 * It reuses the existing controls rather than inventing new ones: the model selector
 * (GroupedChoiceControl), the tool picker (ToolSelectorPopover + ToolItemControl), the MCP
 * server editor (McpServerItemControl), the skill editor (SkillConfigControl), enum selects
 * (harness, sandbox, permission policy), and a textarea (agents_md). The field shape is the
 * `agent_config` catalog type generated
 * from the SDK model (AgentConfigSchema in agenta.sdk.utils.types); the agent service ships a
 * thin `x-ag-type-ref` the playground resolves and reads back (services/oss/src/agent).
 */
import {useCallback, useMemo, useState} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {LabeledField} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/styles"
import {CaretDown, CaretRight, Plus} from "@phosphor-icons/react"
import {Button, Select, Switch, Typography} from "antd"

import {ClaudePermissionsControl} from "./ClaudePermissionsControl"
import {
    allowedConnectionModes,
    allowedProviders,
    composeModelValue,
    connectionFromConfig,
    modelIdFromConfig,
    type ConnectionMode,
} from "./connectionUtils"
import {EnumSelectControl} from "./EnumSelectControl"
import {GroupedChoiceControl} from "./GroupedChoiceControl"
import {McpServerItemControl} from "./McpServerItemControl"
import {SandboxPermissionControl} from "./SandboxPermissionControl"
import {isPlatformSkill, SkillConfigControl} from "./SkillConfigControl"
import {TextInputControl} from "./TextInputControl"
import {ToolItemControl} from "./ToolItemControl"
import {ToolSelectorPopover, type ToolSelectionMeta} from "./ToolSelectorPopover"
import {type ToolObj} from "./toolUtils"

const CONNECTION_MODE_LABELS: Record<ConnectionMode, string> = {
    self_managed: "Self-managed",
    agenta: "Agenta connection",
}

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
    const {EditorProvider, SharedEditor, gatewayTools} = useDrillInUI()
    const config = (value ?? {}) as Record<string, unknown>
    const props = (schema?.properties ?? {}) as Record<string, SchemaProperty>

    // Update a single field of the agent config, leaving the rest intact.
    const setField = useCallback(
        (key: string, fieldValue: unknown) => onChange({...config, [key]: fieldValue}),
        [config, onChange],
    )

    // Model + credential connection (the ModelRef). `config.model` is either a plain string
    // (the default connection, kept byte-identical to today) or a structured object the SDK
    // coerces into a ModelRef. The form edits the fields directly via composeModelValue.
    const harness = typeof config.harness === "string" ? config.harness : null
    const modelId = useMemo(() => modelIdFromConfig(config.model), [config.model])
    const connection = useMemo(() => connectionFromConfig(config.model), [config.model])
    const providerOptions = useMemo(() => allowedProviders(harness), [harness])
    const providersOpen = providerOptions.includes("*")
    const modeOptions = useMemo(() => allowedConnectionModes(harness), [harness])

    // Compose the new `config.model` from the current connection fields, overriding one of
    // them. Empty provider/slug clear that part of the structured value.
    const writeModel = useCallback(
        (patch: {
            modelId?: string | null
            provider?: string | null
            mode?: ConnectionMode
            slug?: string | null
        }) =>
            setField(
                "model",
                composeModelValue({
                    modelId: patch.modelId !== undefined ? patch.modelId : modelId,
                    provider: patch.provider !== undefined ? patch.provider : connection.provider,
                    mode: patch.mode !== undefined ? patch.mode : connection.mode,
                    slug: patch.slug !== undefined ? patch.slug : connection.slug,
                    // Carry through extra ModelRef keys (params, ...) the form does not edit.
                    existing: config.model,
                }),
            ),
        [setField, modelId, connection, config.model],
    )

    // Raw-JSON escape hatch for the whole `config.model` value (collapsed by default).
    const [showModelJson, setShowModelJson] = useState(false)
    const [modelJsonText, setModelJsonText] = useState<string>(() =>
        JSON.stringify(config.model ?? "", null, 2),
    )
    const handleModelJsonChange = useCallback(
        (text: string) => {
            setModelJsonText(text)
            try {
                setField("model", text ? JSON.parse(text) : "")
            } catch {
                // Keep the invalid text in the editor; don't propagate until it parses.
            }
        },
        [setField],
    )
    const handleToggleModelJson = useCallback(
        (next: boolean) => {
            if (next) setModelJsonText(JSON.stringify(config.model ?? "", null, 2))
            setShowModelJson(next)
        },
        [config.model],
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

    // Skills are a sibling of tools/mcp_servers: a flat array on the agent config. Each entry is
    // either an inline SKILL.md package (name + description + body + optional files/flags) or an
    // `@ag.embed` reference the backend inlines into that same shape. Both are edited as JSON the
    // backend resolver parses identically; an embed entry round-trips intact (see SkillConfigControl).
    const skills = useMemo(
        () => (Array.isArray(config.skills) ? (config.skills as unknown[]) : []),
        [config.skills],
    )
    const setSkills = useCallback((next: unknown[]) => setField("skills", next), [setField])
    const handleAddSkill = useCallback(
        () => setSkills([...skills, {name: "", description: "", body: ""}]),
        [skills, setSkills],
    )
    const handleSkillChange = useCallback(
        (index: number, next: Record<string, unknown>) => {
            const updated = [...skills]
            updated[index] = next
            setSkills(updated)
        },
        [skills, setSkills],
    )
    const handleSkillDelete = useCallback(
        (index: number) => setSkills(skills.filter((_, i) => i !== index)),
        [skills, setSkills],
    )

    // Layer 2: the sandbox security boundary (`sandbox_permission`). Applies to every harness.
    // Stored as a nested object; an unset value stays null until the author changes something.
    const sandboxPermission = useMemo(
        () =>
            config.sandbox_permission && typeof config.sandbox_permission === "object"
                ? (config.sandbox_permission as Record<string, unknown>)
                : null,
        [config.sandbox_permission],
    )

    // Layer 1 (Claude-only): the Claude harness's own permission knobs, persisted into the neutral
    // `harness_options.claude.permissions` bag. Hidden when the harness is not Claude.
    const harnessOptions = useMemo(
        () =>
            config.harness_options && typeof config.harness_options === "object"
                ? (config.harness_options as Record<string, unknown>)
                : {},
        [config.harness_options],
    )
    const claudePermissions = useMemo(() => {
        const claude = harnessOptions.claude
        const claudeObj =
            claude && typeof claude === "object" ? (claude as Record<string, unknown>) : undefined
        const perms = claudeObj?.permissions
        return perms && typeof perms === "object" ? (perms as Record<string, unknown>) : null
    }, [harnessOptions])
    // Write `harness_options.claude.permissions`, preserving any other harness_options slices.
    const setClaudePermissions = useCallback(
        (next: Record<string, unknown>) => {
            const claude =
                harnessOptions.claude && typeof harnessOptions.claude === "object"
                    ? (harnessOptions.claude as Record<string, unknown>)
                    : {}
            setField("harness_options", {
                ...harnessOptions,
                claude: {...claude, permissions: next},
            })
        },
        [harnessOptions, setField],
    )
    const [showClaudeAdvanced, setShowClaudeAdvanced] = useState(false)

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
                value={modelId}
                onChange={(v) => writeModel({modelId: v})}
                withTooltip={withTooltip}
                disabled={disabled}
            />

            {/* Connection (provider + credential mode + slug for the ModelRef) */}
            <div className="flex flex-col gap-2">
                <Typography.Text className="text-sm font-medium">Connection</Typography.Text>

                <LabeledField
                    label="Provider"
                    description="The provider family for this model. Leave empty to infer it."
                    withTooltip
                >
                    {providersOpen ? (
                        <TextInputControl
                            value={connection.provider}
                            onChange={(v) => writeModel({provider: v || null})}
                            withTooltip={false}
                            disabled={disabled}
                            placeholder="e.g. openai (optional)"
                        />
                    ) : (
                        <Select
                            value={connection.provider ?? undefined}
                            onChange={(v) => writeModel({provider: v ?? null})}
                            options={providerOptions.map((p) => ({value: p, label: p}))}
                            disabled={disabled}
                            placeholder="Select provider..."
                            allowClear
                            className="w-full"
                            size="small"
                        />
                    )}
                </LabeledField>

                <LabeledField
                    label="Connection mode"
                    description="Where this run's credential comes from."
                    withTooltip
                >
                    <Select<ConnectionMode>
                        value={connection.mode}
                        onChange={(v) => writeModel({mode: v})}
                        options={modeOptions.map((m) => ({
                            value: m,
                            label: CONNECTION_MODE_LABELS[m],
                        }))}
                        disabled={disabled}
                        className="w-full"
                        size="small"
                    />
                </LabeledField>

                {connection.mode === "agenta" && (
                    <div className="flex flex-col gap-1">
                        {/* TODO(provider-model-auth): this becomes a Select fed by an
                            atomWithQuery over GET /vault/connections (Slice 2) once the Fern
                            client exposes that endpoint. Free text until then. */}
                        <TextInputControl
                            label="Connection name"
                            value={connection.slug}
                            onChange={(v) => writeModel({slug: v || null})}
                            description="The name of a connection in this project's vault."
                            disabled={disabled}
                            placeholder="e.g. openai-prod"
                        />
                        {!connection.slug && (
                            // The backend rejects an "agenta" connection with no slug; surface
                            // it here rather than as a raw server validation error on save.
                            <Typography.Text type="danger" className="text-xs">
                                A connection name is required for an Agenta connection.
                            </Typography.Text>
                        )}
                    </div>
                )}

                <div className="flex items-center gap-2">
                    <Switch
                        size="small"
                        checked={showModelJson}
                        onChange={handleToggleModelJson}
                        disabled={disabled}
                    />
                    <Typography.Text className="text-xs">Edit as JSON</Typography.Text>
                </div>
                {showModelJson &&
                    (EditorProvider && SharedEditor ? (
                        <EditorProvider
                            codeOnly
                            language="json"
                            showToolbar={false}
                            enableTokens={false}
                            id="agent-model-json-editor"
                        >
                            <SharedEditor
                                initialValue={modelJsonText}
                                editorProps={{
                                    codeOnly: true,
                                    language: "json",
                                    showLineNumbers: true,
                                    noProvider: true,
                                }}
                                handleChange={handleModelJsonChange}
                                noProvider
                                disableDebounce
                                syncWithInitialValueChanges
                                editorType="border"
                                state={disabled ? "readOnly" : "filled"}
                            />
                        </EditorProvider>
                    ) : (
                        <textarea
                            className="font-mono text-xs p-2 border rounded min-h-[120px] resize-y w-full"
                            value={modelJsonText}
                            onChange={(e) => handleModelJsonChange(e.target.value)}
                            readOnly={disabled}
                        />
                    ))}
            </div>

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
                            gatewayTools={gatewayTools}
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

            {/* Skills */}
            <div className="flex flex-col gap-2">
                <Typography.Text className="text-sm font-medium">Skills</Typography.Text>
                {skills.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {skills.map((skill, index) => {
                            // A platform-owned skill is a default the author cannot remove: no
                            // delete handler (SkillConfigControl also renders it read-only).
                            const platform =
                                skill && typeof skill === "object" && !Array.isArray(skill)
                                    ? isPlatformSkill(skill as Record<string, unknown>)
                                    : false
                            const control = (
                                <SkillConfigControl
                                    key={`skill-${index}`}
                                    value={skill}
                                    onChange={(v) => handleSkillChange(index, v)}
                                    onDelete={
                                        disabled || platform
                                            ? undefined
                                            : () => handleSkillDelete(index)
                                    }
                                    disabled={disabled}
                                />
                            )
                            return EditorProvider ? (
                                <EditorProvider
                                    key={`skill-editor-${index}`}
                                    codeOnly
                                    language="json"
                                    showToolbar={false}
                                    enableTokens={false}
                                    id={`agent-skill-editor-${index}`}
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
                        <Button size="small" icon={<Plus size={14} />} onClick={handleAddSkill}>
                            Add skill
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

            {/* Sandbox permissions (Layer 2): the sandbox security boundary, for every harness. */}
            <SandboxPermissionControl
                value={sandboxPermission}
                onChange={(v) => setField("sandbox_permission", v)}
                disabled={disabled}
            />

            {/*
             * Advanced Claude permissions (Layer 1): Claude-only. Gated on the harness string
             * directly (no harness-capabilities map is wired into this control yet); nothing here
             * applies to Pi. Collapsed by default to keep it clearly "advanced".
             */}
            {harness === "claude" && (
                <div className="flex flex-col gap-2">
                    <button
                        type="button"
                        className="flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer text-left"
                        onClick={() => setShowClaudeAdvanced((v) => !v)}
                    >
                        {showClaudeAdvanced ? <CaretDown size={14} /> : <CaretRight size={14} />}
                        <Typography.Text className="text-sm font-medium">
                            Advanced: Claude permissions
                        </Typography.Text>
                    </button>
                    {showClaudeAdvanced && (
                        <ClaudePermissionsControl
                            value={claudePermissions}
                            onChange={setClaudePermissions}
                            disabled={disabled}
                        />
                    )}
                </div>
            )}
        </div>
    )
}
