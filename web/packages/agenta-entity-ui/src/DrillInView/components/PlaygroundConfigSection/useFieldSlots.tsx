/**
 * Owns the three drill-in render slots for top-level config fields: the section
 * header (collapse caret, model popover, runtime picker, feedback-mode toggle),
 * the actions slot and the content slot (sibling controls vs schema renderer).
 *
 * Extracted as a hook rather than components so the `useCallback` dependency
 * arrays — and therefore the drill-in provider's context identity — keep the
 * same churn profile as the monolithic version.
 */

import {useCallback, useMemo, type ReactNode} from "react"

import {HeightCollapse} from "@agenta/ui"
import type {
    FieldActionsSlotProps,
    FieldContentSlotProps,
    FieldHeaderSlotProps,
} from "@agenta/ui/drill-in"
import {formatLabel} from "@agenta/ui/drill-in"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {CaretDown, CaretRight, MagicWand} from "@phosphor-icons/react"
import clsx from "clsx"

import {HookConfigControl, CodeConfigControl, SchemasConfigControl} from "../../SchemaControls"

import type {SiblingGroupKey} from "./constants"
import {hasParameters} from "./schemaData"
import type {PathSchema} from "./types"
import type {PromptModelInfo} from "./useModelConfigurePopover"

const RUNTIME_SELECT_OPTIONS = ["python", "typescript", "javascript"].map((value) => ({
    label: <span className="capitalize">{value}</span>,
    value,
}))

interface UseFieldSlotsParams {
    activeData: {parameters?: Record<string, unknown>} | null
    codeRuntime: string | undefined
    collapsedSections: Record<string, boolean>
    configurePopoverContent: ReactNode
    disabled: boolean
    feedbackMode: "basic" | "advanced"
    handleConfigureOpenChange: (open: boolean) => void
    handleRuntimeChange: (runtime: string) => void
    isModelConfigOpen: boolean
    isPresentSiblingGroup: (fieldKey: string) => fieldKey is SiblingGroupKey
    onRefinePrompt?: (promptKey: string) => void
    parameters: Record<string, unknown>
    promptModelInfo: PromptModelInfo
    /** The picker's own name for the stored model; the raw id only when nothing offers it. */
    selectedModelLabel: string | null
    schema: PathSchema | null
    setFeedbackMode: (mode: "basic" | "advanced") => void
    siblingGroups: Record<string, unknown>
    stickyHeaderTop: number
    toggleSection: (key: string) => void
}

export function useFieldSlots({
    activeData,
    codeRuntime,
    collapsedSections,
    configurePopoverContent,
    disabled,
    feedbackMode,
    handleConfigureOpenChange,
    handleRuntimeChange,
    isModelConfigOpen,
    isPresentSiblingGroup,
    onRefinePrompt,
    parameters,
    promptModelInfo,
    selectedModelLabel,
    schema,
    setFeedbackMode,
    siblingGroups,
    stickyHeaderTop,
    toggleSection,
}: UseFieldSlotsParams) {
    // ========== FIELD ACTIONS SLOT ==========
    const fieldActionsSlot = useCallback((props: FieldActionsSlotProps) => {
        if (props.path.length === 1) return null
        return props.defaultRender()
    }, [])

    // ========== FIELD HEADER SLOT ==========
    const fieldHeaderSlot = useCallback(
        (props: FieldHeaderSlotProps) => {
            const fieldKey = String(props.field.key)
            const isTopLevel = props.path.length === 1
            if (!isTopLevel) return props.defaultRender()

            // Hide llms header when handled by the model popover
            if (fieldKey === "llms" && promptModelInfo?.isRootLevel) {
                return null
            }

            // Sibling group (hook/code) always gets a section header.
            const isSibling = isPresentSiblingGroup(fieldKey)

            // Scalar/array params render inline (no header); only objects get one.
            const fieldValue = isSibling ? siblingGroups[fieldKey] : parameters[fieldKey]
            if (
                !isSibling &&
                (fieldValue === null ||
                    fieldValue === undefined ||
                    typeof fieldValue !== "object" ||
                    Array.isArray(fieldValue))
            ) {
                return null
            }

            // Show model popover on "prompt" section header.
            // For canonical schemas (no prompt wrapper), show it on the "messages" section.
            const isPromptWithPopover =
                (fieldKey === "prompt" ||
                    (fieldKey === "messages" && promptModelInfo?.isRootLevel)) &&
                !!promptModelInfo
            const isCollapsed = !!collapsedSections[fieldKey]

            // Determine if this field has messages for the refine button
            const hasMessages =
                !!fieldValue &&
                typeof fieldValue === "object" &&
                !Array.isArray(fieldValue) &&
                Array.isArray((fieldValue as Record<string, unknown>).messages)

            // Get display label from schema title if available, falling back to formatLabel
            const fieldSchema = schema?.properties
                ? (schema.properties as Record<string, Record<string, unknown>>)[fieldKey]
                : null
            const schemaTitle = fieldSchema?.title as string | undefined

            // Agent workflows render the whole agent block as the panel body (its own sections each
            // have headers and drawers), so the redundant top-level "Agent" collapse header is
            // suppressed. Detected via the same schema marker AgentTemplateControl dispatches on —
            // both the new `agent-template` and the legacy `agent_config` name, so it holds across
            // the rename / un-migrated data.
            const isAgentMarker = (v: unknown) => v === "agent-template" || v === "agent_config"
            if (
                isAgentMarker(fieldSchema?.["x-ag-type-ref"]) ||
                isAgentMarker(fieldSchema?.["x-ag-type"])
            ) {
                return null
            }

            const displayLabel = schemaTitle
                ? schemaTitle.includes(" ")
                    ? schemaTitle
                    : formatLabel(schemaTitle)
                : formatLabel(fieldKey)

            return (
                <div
                    className={clsx(
                        "flex items-center justify-between w-full px-3 py-2 bg-[var(--ag-surface-section-header)] border-0 border-b border-solid border-colorBorderSecondary cursor-pointer select-none sticky z-[2]",
                        // Space above the code/hook section when params precede it.
                        isSibling && hasParameters(activeData) && "mt-4",
                    )}
                    style={{top: stickyHeaderTop}}
                    onClick={() => toggleSection(fieldKey)}
                >
                    <div className="flex items-center gap-1">
                        <span className="text-[var(--ag-rgba-051729-45)] flex items-center">
                            {isCollapsed ? (
                                <CaretRight size={14} weight="bold" />
                            ) : (
                                <CaretDown size={14} weight="bold" />
                            )}
                        </span>
                        <span className="capitalize font-medium text-sm">{displayLabel}</span>
                    </div>

                    {isPromptWithPopover && promptModelInfo && (
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-2 flex-shrink-0"
                        >
                            {/* Note: the prompt template_format picker is NOT
                             *  rendered here. Per Mahmoud's QA on the
                             *  mustache rollout (Slack #release-v100, 2026-
                             *  05-28), the picker only belongs to the right
                             *  of the output-type / response-format control
                             *  inside `PromptSchemaControl`, not in this
                             *  section header. Adding it here was a
                             *  duplicate placement (commit 2854349c47) and
                             *  has been reverted. The original picker in
                             *  `PromptSchemaControl` continues to handle
                             *  the format choice for the playground. */}
                            {!disabled && onRefinePrompt && hasMessages && (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() => onRefinePrompt(fieldKey)}
                                                aria-label="Refine prompt with AI"
                                                className="opacity-60 hover:opacity-100"
                                            >
                                                <MagicWand size={16} aria-hidden="true" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Refine prompt with AI</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            )}
                            <Popover
                                open={isModelConfigOpen}
                                onOpenChange={handleConfigureOpenChange}
                            >
                                <PopoverTrigger asChild>
                                    <Button size="sm" variant="outline">
                                        {selectedModelLabel || "Select model"}
                                        <CaretDown size={12} />
                                    </Button>
                                </PopoverTrigger>
                                {/* antd `placement="bottomRight"` + `overlayInnerStyle={{padding: 0}}`. */}
                                <PopoverContent side="bottom" align="end" className="p-0">
                                    {configurePopoverContent}
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}

                    {/* Code: runtime picker in section header (like the model picker). */}
                    {isSibling && fieldKey === "code" && (
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-2 flex-shrink-0"
                        >
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild disabled={disabled}>
                                    <Button size="sm" variant="outline">
                                        {RUNTIME_SELECT_OPTIONS.find((o) => o.value === codeRuntime)
                                            ?.label ?? "Select runtime"}
                                        <CaretDown size={12} />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    {RUNTIME_SELECT_OPTIONS.map((o) => (
                                        <DropdownMenuItem
                                            key={o.value}
                                            onSelect={() => handleRuntimeChange(o.value)}
                                            // antd `menu.selectedKeys` skin: colorPrimary on controlItemBgActive.
                                            className={clsx(
                                                o.value === codeRuntime &&
                                                    "bg-controlItemBgActive text-primary",
                                            )}
                                        >
                                            {o.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    )}

                    {/* Feedback config: Advanced Mode toggle in section header */}
                    {fieldKey === "feedback_config" && (
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center flex-shrink-0"
                        >
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    setFeedbackMode(feedbackMode === "basic" ? "advanced" : "basic")
                                }
                                disabled={disabled}
                                className="text-xs text-gray-500"
                            >
                                {feedbackMode === "basic" ? "Advanced" : "Basic"}
                            </Button>
                        </div>
                    )}
                </div>
            )
        },
        [
            collapsedSections,
            toggleSection,
            promptModelInfo,
            isModelConfigOpen,
            disabled,
            parameters,
            schema,
            feedbackMode,
            setFeedbackMode,
            handleConfigureOpenChange,
            configurePopoverContent,
            onRefinePrompt,
            siblingGroups,
            isPresentSiblingGroup,
            codeRuntime,
            handleRuntimeChange,
            stickyHeaderTop,
            // activeData omitted: its only use is hasParameters(activeData), which `parameters` tracks.
        ],
    )

    // ========== FIELD CONTENT SLOT ==========
    const fieldContentSlot = useCallback(
        (props: FieldContentSlotProps) => {
            const isTopLevel = props.path.length === 1
            if (!isTopLevel) return props.defaultRender()

            const fieldKey = String(props.field.key)

            // Hide llms field when the model popover handles it
            // (canonical schema — llms[0] is shown in the model popover on the messages header)
            if (fieldKey === "llms" && promptModelInfo?.isRootLevel) {
                return null
            }

            // Sibling group (hook/code): render the dedicated control, not the
            // schema renderer.
            const isSibling = isPresentSiblingGroup(fieldKey)
            const isCollapsed = !!collapsedSections[fieldKey]

            if (isSibling) {
                return (
                    <HeightCollapse open={!isCollapsed}>
                        <div className="px-4 py-3 flex flex-col gap-3">
                            {fieldKey === "schemas" ? (
                                <SchemasConfigControl
                                    value={siblingGroups[fieldKey] as Record<string, unknown>}
                                    onChange={(next) => props.onChange(next)}
                                    disabled={disabled}
                                />
                            ) : fieldKey === "hook" ? (
                                <HookConfigControl
                                    value={siblingGroups[fieldKey] as Record<string, unknown>}
                                    onChange={(next) => props.onChange(next)}
                                    disabled={disabled}
                                />
                            ) : (
                                <CodeConfigControl
                                    value={siblingGroups[fieldKey] as Record<string, unknown>}
                                    onChange={(next) => props.onChange(next)}
                                    disabled={disabled}
                                />
                            )}
                        </div>
                    </HeightCollapse>
                )
            }

            // Scalar/array params render directly, without HeightCollapse.
            const fieldValue = parameters[fieldKey]
            if (
                fieldValue === null ||
                fieldValue === undefined ||
                typeof fieldValue !== "object" ||
                Array.isArray(fieldValue)
            ) {
                return <div className="px-4 py-1.5">{props.defaultRender()}</div>
            }

            // The agent body is always expanded (its header is suppressed above), so it renders
            // without the HeightCollapse toggle. Detected via the same marker as the header
            // suppression — both the new `agent-template` and legacy `agent_config` name, so it
            // holds across the rename (checking only `agent_config` here sent modern agent fields
            // to the generic else branch, re-adding the collapse and the wider py-3 inset).
            const fieldSchema = schema?.properties
                ? (schema.properties as Record<string, Record<string, unknown>>)[fieldKey]
                : null
            const isAgentMarker = (v: unknown) => v === "agent-template" || v === "agent_config"
            if (
                isAgentMarker(fieldSchema?.["x-ag-type-ref"]) ||
                isAgentMarker(fieldSchema?.["x-ag-type"])
            ) {
                // pt-0 (not py-3) tightens the gap between the region header and the first section
                // row; pb-3 keeps the bottom breathing room. The loading fallback below matches.
                return <div className="px-4 pb-3 pt-0">{props.defaultRender()}</div>
            }

            return (
                <HeightCollapse open={!isCollapsed}>
                    <div className="px-4 py-3">{props.defaultRender()}</div>
                </HeightCollapse>
            )
        },
        [
            collapsedSections,
            parameters,
            schema,
            siblingGroups,
            isPresentSiblingGroup,
            disabled,
            promptModelInfo?.isRootLevel,
        ],
    )

    // Stable slots object — an inline literal would churn the drill-in provider's context value.
    const drillInSlots = useMemo(
        () => ({
            fieldHeader: fieldHeaderSlot,
            fieldActions: fieldActionsSlot,
            fieldContent: fieldContentSlot,
        }),
        [fieldHeaderSlot, fieldActionsSlot, fieldContentSlot],
    )

    return drillInSlots
}
