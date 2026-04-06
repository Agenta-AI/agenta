/**
 * ToolItemControl
 *
 * Schema-driven control for rendering a single tool definition.
 * Handles both custom function tools and provider-specific builtin tools
 * (OpenAI, Anthropic, Google Gemini).
 *
 * Replaces the legacy PlaygroundTool component with a schema-driven approach
 * that doesn't depend on playground atoms or enhanced values.
 *
 * Features:
 * - JSON editor for tool definition
 * - Header with function name/description (custom) or provider icon/label (builtin)
 * - Delete and minimize controls
 * - Builtin tool detection via tools.specs.json
 * - JSON5 parsing for forgiving input
 */

import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {safeStringify} from "@agenta/shared/utils"
import {CollapseToggleButton, getCollapseStyle} from "@agenta/ui/components/presentational"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {CopySimple, MinusCircle} from "@phosphor-icons/react"
import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"

import {TOOL_PROVIDERS_META, TOOL_SPECS, parseGatewayFunctionName, type ToolObj} from "./toolUtils"

// ============================================================================
// JSON HELPERS
// ============================================================================

/** Stable stringify — sorts keys recursively for reliable deep comparison */
function stableStringify(input: unknown): string {
    const seen = new WeakSet()
    function sortKeys(value: unknown): unknown {
        if (value && typeof value === "object") {
            if (seen.has(value as object)) return null
            seen.add(value as object)
            if (Array.isArray(value)) return value.map(sortKeys)
            const out: Record<string, unknown> = {}
            Object.keys(value as Record<string, unknown>)
                .sort()
                .forEach((k) => {
                    out[k] = sortKeys((value as Record<string, unknown>)[k])
                })
            return out
        }
        return value
    }
    try {
        return JSON.stringify(sortKeys(input))
    } catch {
        return ""
    }
}

function deepEqual(a: unknown, b: unknown): boolean {
    return stableStringify(a) === stableStringify(b)
}

function toToolObj(value: unknown): ToolObj {
    try {
        if (typeof value === "string") {
            if (!value) return {}
            // Use standard JSON.parse as fallback — JSON5 would be ideal but
            // we avoid adding the dependency to entity-ui. The SharedEditor
            // provides JSON5 parsing on its own.
            return JSON.parse(value) as ToolObj
        }
        if (value && typeof value === "object") return value as ToolObj
        return {}
    } catch {
        return {}
    }
}

// ============================================================================
// BUILTIN TOOL DETECTION
// ============================================================================

function formatBuiltinLabel(value: string): string {
    return value
        .split("_")
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" ")
}

function inferIsBuiltinTool(toolObj: ToolObj): boolean {
    if (!toolObj || typeof toolObj !== "object") return false
    const keys = Object.keys(toolObj)
    if (keys.length === 0) return false
    const typeValue = (toolObj as Record<string, unknown>).type
    const hasFunction =
        typeValue === "function" || "function" in (toolObj as Record<string, unknown>)
    if (hasFunction) return false
    if (typeof typeValue === "string") return true
    return keys.some((key) => key !== "type")
}

function inferBuiltinLabel(toolObj: ToolObj): string | undefined {
    if (!toolObj || typeof toolObj !== "object") return undefined
    const typeValue = (toolObj as Record<string, unknown>).type
    if (typeof typeValue === "string" && typeValue !== "function") {
        return formatBuiltinLabel(typeValue)
    }
    const keys = Object.keys(toolObj).filter((key) => key !== "type" && key !== "function")
    if (keys.length === 0) return undefined
    return formatBuiltinLabel(keys[0])
}

interface BuiltinToolInfo {
    providerKey?: string
    toolCode?: string
}

function matchesToolPayload(toolObj: ToolObj, payload: Record<string, unknown>): boolean {
    if (!toolObj || typeof toolObj !== "object" || !payload) return false
    const toolObjAny = toolObj as Record<string, unknown>
    if (typeof payload.type === "string" && toolObjAny.type === payload.type) return true
    if (typeof payload.name === "string" && toolObjAny.name === payload.name) return true
    const payloadKeys = Object.keys(payload)
    if (
        payloadKeys.length === 1 &&
        payloadKeys[0] !== "type" &&
        payloadKeys[0] !== "name" &&
        payloadKeys[0] in toolObjAny
    )
        return true
    return false
}

function inferBuiltinToolInfo(toolObj: ToolObj): BuiltinToolInfo | undefined {
    if (!toolObj || typeof toolObj !== "object") return undefined
    for (const [providerKey, tools] of Object.entries(TOOL_SPECS)) {
        for (const [toolCode, toolSpec] of Object.entries(tools)) {
            const payloads = Array.isArray(toolSpec) ? toolSpec : [toolSpec]
            for (const payload of payloads) {
                if (matchesToolPayload(toolObj, payload as Record<string, unknown>)) {
                    return {providerKey, toolCode}
                }
            }
        }
    }
    return undefined
}

// ============================================================================
// TOOL STATE HOOK
// ============================================================================

function useToolState(
    initialValue: unknown,
    isReadOnly: boolean,
    onChange?: (obj: ToolObj) => void,
) {
    const [toolObj, setToolObj] = useState<ToolObj>(() => toToolObj(initialValue))
    const [editorText, setEditorText] = useState<string>(() => safeStringify(toolObj ?? {}))
    const [editorValid, setEditorValid] = useState(true)

    const lastSentSerializedRef = useRef<string>(stableStringify(toolObj))

    useEffect(() => {
        if (isReadOnly || !onChange) return
        const current = stableStringify(toolObj)
        if (current !== lastSentSerializedRef.current) {
            lastSentSerializedRef.current = current
            onChange(toolObj)
        }
    }, [toolObj, onChange, isReadOnly])

    const lastPropValueRef = useRef<string>(stableStringify(toToolObj(initialValue)))
    useEffect(() => {
        const nextParsed = toToolObj(initialValue)
        const nextSerialized = stableStringify(nextParsed)
        if (nextSerialized !== lastPropValueRef.current) {
            lastPropValueRef.current = nextSerialized
            setToolObj(nextParsed)
            setEditorText(safeStringify(nextParsed ?? {}))
            setEditorValid(true)
        }
    }, [initialValue])

    const onEditorChange = useCallback(
        (text: string) => {
            if (isReadOnly) return
            setEditorText(text)
            try {
                const parsed = text ? (JSON.parse(text) as ToolObj) : {}
                setEditorValid(true)
                setToolObj((prev) => (deepEqual(prev, parsed) ? prev : parsed))
            } catch {
                setEditorValid(false)
            }
        },
        [isReadOnly],
    )

    return {toolObj, editorText, editorValid, onEditorChange}
}

// ============================================================================
// TOOL HEADER
// ============================================================================

/** JSON schema for custom function tool validation */
export const TOOL_SCHEMA = {
    type: "object",
    properties: {
        type: {type: "string", enum: ["function"]},
        function: {
            type: "object",
            properties: {
                name: {type: "string"},
                description: {type: "string"},
                parameters: {
                    type: "object",
                    properties: {
                        type: {type: "string", enum: ["object"]},
                        properties: {
                            type: "object",
                            additionalProperties: {
                                type: "object",
                                properties: {
                                    type: {type: "string"},
                                    description: {type: "string"},
                                },
                                required: ["type"],
                            },
                        },
                        required: {type: "array", items: {type: "string"}},
                        additionalProperties: {type: "boolean"},
                    },
                    required: ["type", "properties", "required", "additionalProperties"],
                },
            },
            required: ["name", "description", "parameters"],
        },
    },
    required: ["type", "function"],
}

interface ToolHeaderProps {
    name: string
    desc: string
    isReadOnly: boolean
    minimized: boolean
    onToggleMinimize: () => void
    onDelete?: () => void
    onDuplicate?: () => void
    isBuiltinTool?: boolean
    builtinProviderLabel?: string
    builtinToolLabel?: string
    builtinIcon?: React.ReactNode
    gatewayHeader?: React.ReactNode
    containerRef?: React.RefObject<HTMLElement | null>
}

function GatewayToolHeaderIdentity({
    integrationKey,
    actionLabel,
    connectionLabel,
    logo,
}: {
    integrationKey: string
    actionLabel: string
    connectionLabel: string
    logo?: string
}) {
    return (
        <div className="flex items-center gap-1.5 min-w-0">
            {logo ? (
                <img
                    src={logo}
                    alt={integrationKey}
                    className="h-6 w-6 rounded object-contain shrink-0"
                />
            ) : null}
            <Typography.Text className="truncate">
                {integrationKey} / {actionLabel} / {connectionLabel}
            </Typography.Text>
        </div>
    )
}

function GatewayToolHeaderWithHook({
    integrationKey,
    actionLabel,
    connectionLabel,
    useIntegrationInfo,
}: {
    integrationKey: string
    actionLabel: string
    connectionLabel: string
    useIntegrationInfo: NonNullable<
        NonNullable<ReturnType<typeof useDrillInUI>["gatewayTools"]>["useIntegrationInfo"]
    >
}) {
    const info = useIntegrationInfo(integrationKey)
    return (
        <GatewayToolHeaderIdentity
            integrationKey={integrationKey}
            actionLabel={actionLabel}
            connectionLabel={connectionLabel}
            logo={info.logo}
        />
    )
}

function GatewayToolHeader({
    integrationKey,
    actionLabel,
    connectionLabel,
    logo,
}: {
    integrationKey: string
    actionLabel: string
    connectionLabel: string
    logo?: string
}) {
    return (
        <GatewayToolHeaderIdentity
            integrationKey={integrationKey}
            actionLabel={actionLabel}
            connectionLabel={connectionLabel}
            logo={logo}
        />
    )
}

const ToolHeader = memo(function ToolHeader({
    name,
    desc,
    isReadOnly,
    minimized,
    onToggleMinimize,
    onDelete,
    onDuplicate,
    isBuiltinTool,
    builtinProviderLabel,
    builtinToolLabel,
    builtinIcon,
    gatewayHeader,
    containerRef,
}: ToolHeaderProps) {
    return (
        <div className="w-full flex items-start justify-between py-1">
            <div className="grow min-w-0">
                {gatewayHeader ? (
                    gatewayHeader
                ) : isBuiltinTool ? (
                    <div className="flex items-center gap-1">
                        <div className="flex items-center">
                            {builtinIcon && (
                                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-[#F8FAFC]">
                                    {builtinIcon}
                                </span>
                            )}
                            {builtinProviderLabel && (
                                <Typography.Text>{builtinProviderLabel}</Typography.Text>
                            )}
                        </div>

                        {builtinToolLabel && (
                            <>
                                {builtinProviderLabel && <Typography.Text>/</Typography.Text>}
                                <Typography.Text type="secondary">
                                    {builtinToolLabel}
                                </Typography.Text>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-0.5">
                        <Typography.Text strong className="text-sm truncate">
                            {name || "Function Name"}
                        </Typography.Text>
                        {desc ? (
                            <Typography.Text type="secondary" className="text-xs">
                                {desc}
                            </Typography.Text>
                        ) : (
                            <Typography.Text type="secondary" className="text-xs opacity-50">
                                Function Description
                            </Typography.Text>
                        )}
                    </div>
                )}
            </div>

            <div className="flex items-center gap-1 invisible group-hover/tool:visible shrink-0">
                {!isReadOnly && onDuplicate && (
                    <Tooltip title="Duplicate">
                        <Button
                            icon={<CopySimple size={14} />}
                            type="text"
                            onClick={onDuplicate}
                            size="small"
                        />
                    </Tooltip>
                )}
                {!isReadOnly && onDelete && (
                    <Tooltip title="Remove">
                        <Button
                            icon={<MinusCircle size={14} />}
                            type="text"
                            onClick={onDelete}
                            size="small"
                        />
                    </Tooltip>
                )}
                <CollapseToggleButton
                    collapsed={minimized}
                    onToggle={onToggleMinimize}
                    contentRef={containerRef}
                />
            </div>
        </div>
    )
})

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Default provider icon renderer using getProviderIcon from @agenta/ui
 */
function defaultRenderProviderIcon(providerKey: string): React.ReactNode {
    const Icon = getProviderIcon(providerKey)
    if (!Icon) return null
    return <Icon className="w-4 h-4" />
}

export interface ToolItemControlProps {
    /** Tool value (object or JSON string) */
    value: unknown
    /** Called when tool value changes */
    onChange?: (value: ToolObj) => void
    /** Called when tool should be deleted */
    onDelete?: () => void
    /** Called when tool should be duplicated */
    onDuplicate?: () => void
    /** Whether the control is read-only */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
    /** Optional LLM icon renderer — receives provider key, returns icon element */
    renderProviderIcon?: (providerKey: string) => React.ReactNode
}

export const ToolItemControl = memo(function ToolItemControl({
    value,
    onChange,
    onDelete,
    onDuplicate,
    disabled = false,
    className,
    renderProviderIcon,
}: ToolItemControlProps) {
    const {SharedEditor, gatewayTools} = useDrillInUI()

    // Use prop if provided, otherwise use default
    const effectiveRenderProviderIcon = renderProviderIcon ?? defaultRenderProviderIcon

    const isReadOnly = disabled
    const [minimized, setMinimized] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    // Strip agenta_metadata if present (re-attach on change)
    const {cleanedValue, agentaMetadata} = useMemo(() => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const obj = value as Record<string, unknown>
            if ("agenta_metadata" in obj) {
                const {agenta_metadata, ...rest} = obj
                return {cleanedValue: rest, agentaMetadata: agenta_metadata}
            }
        }
        return {cleanedValue: value, agentaMetadata: undefined}
    }, [value])

    const handleChange = useCallback(
        (next: ToolObj) => {
            if (!onChange) return
            const merged = agentaMetadata ? {...next, agenta_metadata: agentaMetadata} : next
            onChange(merged)
        },
        [onChange, agentaMetadata],
    )

    const {
        toolObj,
        editorText,
        editorValid: _editorValid,
        onEditorChange,
    } = useToolState(cleanedValue, isReadOnly, handleChange)

    const functionName =
        (toolObj as Record<string, unknown>)?.function &&
        typeof (toolObj as Record<string, unknown>).function === "object"
            ? (((toolObj as Record<string, unknown>).function as Record<string, unknown>).name as
                  | string
                  | undefined)
            : undefined

    // Builtin detection
    const isBuiltinInferred = useMemo(() => inferIsBuiltinTool(toolObj), [toolObj])

    // Check agenta_metadata for source
    const isBuiltinFromMeta = useMemo(() => {
        if (agentaMetadata && typeof agentaMetadata === "object") {
            return (agentaMetadata as Record<string, unknown>).source === "builtin"
        }
        return false
    }, [agentaMetadata])

    const isBuiltinTool = isBuiltinFromMeta || isBuiltinInferred

    const inferredToolInfo = useMemo(() => inferBuiltinToolInfo(toolObj), [toolObj])
    const fallbackToolLabel = useMemo(() => inferBuiltinLabel(toolObj), [toolObj])
    const parsedGatewayTool = useMemo(() => parseGatewayFunctionName(functionName), [functionName])
    const isGatewayTool = useMemo(() => {
        if (agentaMetadata && typeof agentaMetadata === "object") {
            return (agentaMetadata as Record<string, unknown>).source === "gateway"
        }
        return Boolean(parsedGatewayTool)
    }, [agentaMetadata, parsedGatewayTool])

    // Provider metadata
    const providerKey = useMemo(() => {
        if (agentaMetadata && typeof agentaMetadata === "object") {
            const meta = agentaMetadata as Record<string, unknown>
            if (meta.provider) return meta.provider as string
        }
        if (parsedGatewayTool?.provider) return parsedGatewayTool.provider
        return inferredToolInfo?.providerKey
    }, [agentaMetadata, inferredToolInfo, parsedGatewayTool])

    const providerConfig = providerKey ? TOOL_PROVIDERS_META[providerKey] : undefined

    const providerLabel = useMemo(() => {
        if (agentaMetadata && typeof agentaMetadata === "object") {
            const meta = agentaMetadata as Record<string, unknown>
            if (meta.providerLabel) return meta.providerLabel as string
        }
        return providerConfig?.label || providerKey
    }, [agentaMetadata, providerConfig, providerKey])

    const toolLabel = useMemo(() => {
        if (agentaMetadata && typeof agentaMetadata === "object") {
            const meta = agentaMetadata as Record<string, unknown>
            if (meta.toolCode) return meta.toolCode as string
            if (meta.toolLabel) return meta.toolLabel as string
        }
        return inferredToolInfo?.toolCode ?? fallbackToolLabel
    }, [agentaMetadata, inferredToolInfo, fallbackToolLabel])

    const providerIcon = useMemo(() => {
        if (effectiveRenderProviderIcon && providerKey) {
            return effectiveRenderProviderIcon(providerKey)
        }
        return null
    }, [effectiveRenderProviderIcon, providerKey])

    const gatewayHeader = useMemo(() => {
        if (!isGatewayTool) return null

        const meta =
            agentaMetadata && typeof agentaMetadata === "object"
                ? (agentaMetadata as Record<string, unknown>)
                : undefined

        const integrationKey =
            (meta?.integrationKey as string | undefined) ?? parsedGatewayTool?.integration
        const actionLabel =
            (meta?.toolLabel as string | undefined) ??
            (meta?.toolCode as string | undefined) ??
            parsedGatewayTool?.action
        const connectionLabel =
            (meta?.connectionSlug as string | undefined) ?? parsedGatewayTool?.connection

        if (!integrationKey || !actionLabel || !connectionLabel) return null

        if (gatewayTools?.useIntegrationInfo) {
            return (
                <GatewayToolHeaderWithHook
                    integrationKey={integrationKey}
                    actionLabel={actionLabel}
                    connectionLabel={connectionLabel}
                    useIntegrationInfo={gatewayTools.useIntegrationInfo}
                />
            )
        }

        const info = gatewayTools?.renderIntegrationInfo?.(integrationKey)
        return (
            <GatewayToolHeader
                integrationKey={integrationKey}
                actionLabel={actionLabel}
                connectionLabel={connectionLabel}
                logo={info?.logo}
            />
        )
    }, [agentaMetadata, gatewayTools, isGatewayTool, parsedGatewayTool])

    // Fallback when SharedEditor is not injected
    if (!SharedEditor) {
        return (
            <div
                className={clsx("group/tool flex flex-col gap-2 border rounded-lg p-3", className)}
            >
                <ToolHeader
                    name={
                        (toolObj as Record<string, unknown>)?.function
                            ? ((
                                  (toolObj as Record<string, unknown>).function as Record<
                                      string,
                                      string
                                  >
                              )?.name ?? "")
                            : ""
                    }
                    desc={
                        (toolObj as Record<string, unknown>)?.function
                            ? ((
                                  (toolObj as Record<string, unknown>).function as Record<
                                      string,
                                      string
                                  >
                              )?.description ?? "")
                            : ""
                    }
                    isReadOnly={isReadOnly}
                    minimized={minimized}
                    onToggleMinimize={() => setMinimized((v) => !v)}
                    onDelete={onDelete}
                    onDuplicate={onDuplicate}
                    isBuiltinTool={isBuiltinTool}
                    builtinProviderLabel={providerLabel}
                    builtinToolLabel={toolLabel}
                    builtinIcon={providerIcon}
                    gatewayHeader={gatewayHeader}
                    containerRef={containerRef}
                />
                {!minimized && (
                    <textarea
                        className="font-mono text-xs p-2 border rounded min-h-[120px] resize-y w-full"
                        value={editorText}
                        onChange={(e) => onEditorChange(e.target.value)}
                        readOnly={isReadOnly}
                    />
                )}
            </div>
        )
    }

    return (
        <div
            ref={containerRef}
            style={getCollapseStyle(minimized)}
            className={clsx("group/tool flex flex-col", "w-full max-w-full", className)}
        >
            <SharedEditor
                initialValue={editorText}
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: true,
                    noProvider: true,
                    validationSchema: isBuiltinTool ? undefined : TOOL_SCHEMA,
                }}
                handleChange={(e: string) => {
                    if (isReadOnly) return
                    onEditorChange(e)
                }}
                noProvider
                disableDebounce
                syncWithInitialValueChanges
                editorType="border"
                className={clsx("group/tool")}
                state={isReadOnly ? "readOnly" : "filled"}
                header={
                    <ToolHeader
                        name={
                            (toolObj as Record<string, unknown>)?.function
                                ? ((
                                      (toolObj as Record<string, unknown>).function as Record<
                                          string,
                                          string
                                      >
                                  )?.name ?? "")
                                : ""
                        }
                        desc={
                            (toolObj as Record<string, unknown>)?.function
                                ? ((
                                      (toolObj as Record<string, unknown>).function as Record<
                                          string,
                                          string
                                      >
                                  )?.description ?? "")
                                : ""
                        }
                        isReadOnly={isReadOnly}
                        minimized={minimized}
                        onToggleMinimize={() => setMinimized((v) => !v)}
                        onDelete={onDelete}
                        onDuplicate={onDuplicate}
                        isBuiltinTool={isBuiltinTool}
                        builtinProviderLabel={providerLabel}
                        builtinToolLabel={toolLabel}
                        builtinIcon={providerIcon}
                        gatewayHeader={gatewayHeader}
                        containerRef={containerRef}
                    />
                }
            />
        </div>
    )
})
