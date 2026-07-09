/**
 * Tool Item Control
 *
 * Replaces the legacy PlaygroundTool component.
 * Handles tool rendering for both custom function tools and builtin tools
 * (OpenAI, Anthropic, Google Gemini).
 *
 * Architecture:
 * - Uses SharedEditor for JSON editing (injected via context).
 * - Falls back to a plain textarea when SharedEditor is not injected.
 * - Builtin tools: read-only JSON view with provider metadata.
 * - Custom tools: editable JSON with TOOL_SCHEMA validation.
 * - Gateway tools: detected by function name pattern `tools__{provider}__...`.
 *
 * @module agenta-entity-ui/DrillInView/SchemaControls/ToolItemControl
 */

import React, {memo, useCallback, useMemo, useRef, useState} from "react"
import {Typography} from "antd"
import {clsx} from "clsx"
import {useDrillInContext} from "../DrillInContext"
import {useSharedEditor} from "../../SharedEditor/SharedEditorContext"
import {getProviderIcon} from "../../icons"
import {
    TOOL_SCHEMA,
    TOOL_PROVIDERS_META,
    TOOL_SPECS,
    ToolObj,
    parseGatewayFunctionName,
    GatewayToolParsed,
} from "./toolUtils"

// ============================================================================
// COLLAPSE STYLE HELPER
// ============================================================================

function getCollapseStyle(minimized: boolean): React.CSSProperties {
    return minimized
        ? {
              overflow: "hidden",
              maxHeight: 0,
              opacity: 0,
              transition: "max-height 0.2s ease, opacity 0.2s ease",
              pointerEvents: "none",
          }
        : {
              overflow: "visible",
              maxHeight: 2000,
              opacity: 1,
              transition: "max-height 0.3s ease, opacity 0.3s ease",
          }
}

// ============================================================================
// TOOL SCHEMA
// ============================================================================


// ============================================================================
// TOOL HEADER
// ============================================================================

interface ToolHeaderProps {
    name: string
    desc: string
    isReadOnly: boolean
    minimized: boolean
    onToggleMinimize: () => void
    onDelete?: () => void
    onDuplicate?: () => void
    isBuiltinTool: boolean
    builtinProviderLabel?: string
    builtinToolLabel?: string
    builtinIcon?: React.ReactNode
    gatewayHeader?: React.ReactNode
    containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Header for a tool item showing name, description, and action buttons.
 */
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
        <div className="flex items-start justify-between gap-2 px-1">
            <div className="flex items-start gap-2 min-w-0">
                {/* Builtin tool icon */}
                {isBuiltinTool && builtinIcon && (
                    <div className="mt-0.5 shrink-0">{builtinIcon}</div>
                )}

                <div className="min-w-0">
                    {/* Tool name */}
                    <Typography.Text
                        strong
                        className="text-sm block truncate"
                        title={name}
                    >
                        {name || "Untitled Tool"}
                    </Typography.Text>

                    {/* Description */}
                    <Typography.Text
                        type="secondary"
                        className="text-xs block truncate"
                        title={desc}
                    >
                        {desc || "No description"}
                    </Typography.Text>

                    {/* Builtin tool labels */}
                    {isBuiltinTool && (builtinProviderLabel || builtinToolLabel) && (
                        <div className="flex items-center gap-1 mt-0.5">
                            {builtinProviderLabel && (
                                <Typography.Text className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--ag-c-gray-100)] text-[var(--ag-c-gray-600)]">
                                    {builtinProviderLabel}
                                </Typography.Text>
                            )}
                            {builtinToolLabel && (
                                <Typography.Text className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--ag-c-blue-50)] text-[var(--ag-c-blue-600)]">
                                    {builtinToolLabel}
                                </Typography.Text>
                            )}
                        </div>
                    )}

                    {/* Gateway tool header */}
                    {gatewayHeader}
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 shrink-0">
                <button
                    type="button"
                    onClick={onToggleMinimize}
                    className="p-1 rounded hover:bg-[var(--ag-c-gray-100)] transition-colors"
                    title={minimized ? "Expand" : "Collapse"}
                >
                    <svg
                        className={clsx(
                            "w-4 h-4 text-[var(--ag-c-gray-500)] transition-transform",
                            minimized && "rotate-180",
                        )}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                        />
                    </svg>
                </button>

                {!isReadOnly && onDuplicate && (
                    <button
                        type="button"
                        onClick={onDuplicate}
                        className="p-1 rounded hover:bg-[var(--ag-c-gray-100)] transition-colors"
                        title="Duplicate"
                    >
                        <svg
                            className="w-4 h-4 text-[var(--ag-c-gray-500)]"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                        </svg>
                    </button>
                )}

                {!isReadOnly && onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        className="p-1 rounded hover:bg-[var(--ag-c-red-50)] transition-colors"
                        title="Delete"
                    >
                        <svg
                            className="w-4 h-4 text-[var(--ag-c-red-500)]"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    )
})

// ============================================================================
// PROVIDER ICON RENDERER
// ============================================================================

function defaultRenderProviderIcon(providerKey: string): React.ReactNode {
    const Icon = getProviderIcon(providerKey)
    if (!Icon) return null
    return <Icon className="w-4 h-4" />
}

// ============================================================================
// PERMISSION SELECTOR
// ============================================================================

const PermissionSelector = memo(function PermissionSelector({
    permission,
    onChange,
    disabled,
}: {
    permission?: "always" | "ask"
    onChange?: (permission: "always" | "ask") => void
    disabled?: boolean
}) {
    return (
        <div className="flex items-center gap-2 px-3 py-1 border-t">
            <Typography.Text type="secondary" className="text-xs">
                Permission:
            </Typography.Text>
            <select
                value={permission || "always"}
                onChange={(e) => onChange?.(e.target.value as "always" | "ask")}
                disabled={disabled}
                className="text-xs border rounded px-2 py-0.5 bg-transparent"
            >
                <option value="always">Always</option>
                <option value="ask">Ask</option>
            </select>
        </div>
    )
})

// ============================================================================
// PROPS
// ============================================================================

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
    /** Tool permission: "always" | "ask" */
    permission?: "always" | "ask"
    /** Called when permission changes */
    onPermissionChange?: (permission: "always" | "ask") => void
}

// ============================================================================
// TOOL ITEM CONTROL
// ============================================================================

/**
 * Unified tool control for the DrillInView.
 *
 * Replaces legacy PlaygroundTool component.
 * Handles:
 * - Custom function tools (editable JSON with schema validation)
 * - Builtin tools (read-only JSON view with provider metadata)
 * - Gateway tools (detected by function name pattern)
 *
 * @example
 * ```tsx
 * <ToolItemControl
 *   value={toolObj}
 *   onChange={handleChange}
 *   onDelete={handleDelete}
 * />
 * ```
 */
export const ToolItemControl = memo(function ToolItemControl({
    value,
    onChange,
    onDelete,
    onDuplicate,
    disabled = false,
    className,
    renderProviderIcon,
    permission,
    onPermissionChange,
}: ToolItemControlProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [minimized, setMinimized] = useState(false)
    const {SharedEditor} = useSharedEditor()
    const drillIn = useDrillInContext()

    const isReadOnly = disabled || drillIn?.isReadOnly || false

    // -------------------------------------------------------------------------
    // VALUE PARSING
    // -------------------------------------------------------------------------

    const toolObj = useMemo(() => {
        if (!value) return null
        if (typeof value === "string") {
            try {
                return JSON.parse(value) as Record<string, unknown>
            } catch {
                return null
            }
        }
        return value as Record<string, unknown>
    }, [value])

    // -------------------------------------------------------------------------
    // AGENTA METADATA EXTRACTION
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // EDITOR TEXT
    // -------------------------------------------------------------------------

    const editorText = useMemo(() => {
        if (!cleanedValue) return ""
        return typeof cleanedValue === "string"
            ? cleanedValue
            : JSON.stringify(cleanedValue, null, 2)
    }, [cleanedValue])

    // -------------------------------------------------------------------------
    // BUILTIN TOOL DETECTION
    // -------------------------------------------------------------------------

    const builtinMatch = useMemo(() => {
        if (!toolObj) return null
        const fn = (toolObj.function ?? {}) as Record<string, unknown>
        const name = (fn.name ?? "") as string

        for (const [provider, tools] of Object.entries(TOOL_SPECS)) {
            for (const [toolCode, patterns] of Object.entries(tools)) {
                for (const pattern of patterns) {
                    const p = pattern as Record<string, unknown>
                    if (p.type && p.type === fn.type) {
                        return {provider, toolCode, pattern: p}
                    }
                    if (p.name && p.name === name) {
                        return {provider, toolCode, pattern: p}
                    }
                    // Google single-key pattern
                    const keys = Object.keys(p)
                    if (keys.length === 1 && keys[0] in fn) {
                        return {provider, toolCode, pattern: p}
                    }
                }
            }
        }
        return null
    }, [toolObj])

    const isBuiltinTool = !!builtinMatch
    const builtinProvider = builtinMatch?.provider
    const builtinToolCode = builtinMatch?.toolCode

    const providerLabel = builtinProvider
        ? TOOL_PROVIDERS_META[builtinProvider]?.label
        : undefined
    const providerIcon = builtinProvider
        ? (renderProviderIcon ?? defaultRenderProviderIcon)(builtinProvider)
        : null

    const toolLabel = builtinToolCode
        ? builtinToolCode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : undefined

    // -------------------------------------------------------------------------
    // GATEWAY TOOL DETECTION
    // -------------------------------------------------------------------------

    const gatewayParsed = useMemo<GatewayToolParsed | null>(() => {
        if (!toolObj) return null
        const fn = (toolObj.function ?? {}) as Record<string, unknown>
        return parseGatewayFunctionName(fn.name as string | undefined)
    }, [toolObj])

    const gatewayHeader = useMemo(() => {
        if (!gatewayParsed) return null
        return (
            <div className="flex items-center gap-1 mt-0.5">
                <Typography.Text className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--ag-c-purple-50)] text-[var(--ag-c-purple-600)]">
                    {gatewayParsed.provider}
                </Typography.Text>
                <Typography.Text className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--ag-c-gray-100)] text-[var(--ag-c-gray-600)]">
                    {gatewayParsed.integration}
                </Typography.Text>
                <Typography.Text className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--ag-c-blue-50)] text-[var(--ag-c-blue-600)]">
                    {gatewayParsed.action}
                </Typography.Text>
            </div>
        )
    }, [gatewayParsed])

    // -------------------------------------------------------------------------
    // CHANGE HANDLERS
    // -------------------------------------------------------------------------

    const onEditorChange = useCallback(
        (text: string) => {
            if (!onChange) return
            try {
                const parsed = JSON.parse(text) as ToolObj
                const merged = agentaMetadata
                    ? {...parsed, agenta_metadata: agentaMetadata}
                    : parsed
                // Preserve permission in the tool object
                if (permission && merged) {
                    merged.permission = permission
}
                onChange(merged)
            } catch {
                // Invalid JSON — don't call onChange until valid
            }
        },
        [onChange, agentaMetadata, permission],
    )

    const handleChange = useCallback(
        (next: ToolObj) => {
            if (!onChange) return
            const merged = agentaMetadata ? {...next, agenta_metadata: agentaMetadata} : next
            // Preserve permission in the tool object
            if (permission && merged) {
                merged.permission = permission
}
            onChange(merged)
        },
        [onChange, agentaMetadata, permission],
    )

    // -------------------------------------------------------------------------
    // RENDER
    // -------------------------------------------------------------------------

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
                    <PermissionSelector
                        permission={permission}
                        onChange={onPermissionChange}
                        disabled={isReadOnly}
                    />
                )}
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
            {!minimized && (
                <PermissionSelector
                    permission={permission}
                    onChange={onPermissionChange}
                    disabled={isReadOnly}
                />
            )}
        </div>
    )
})