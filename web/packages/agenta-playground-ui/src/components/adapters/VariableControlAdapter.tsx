import React, {useCallback, useEffect, useMemo, useRef} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {getCollapseStyle} from "@agenta/ui/components/presentational"
import {TOGGLE_MARKDOWN_VIEW, EditorProvider, useLexicalComposerContext} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {InputNumber, Switch, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

export interface VariableControlAdapterProps {
    entityId: string
    rowId: string
    variableKey: string
    className?: string
    as?: string
    view?: string
    placeholder?: string
    disabled?: boolean
    /** App type for custom app variable gating (injected by OSS) */
    appType?: string
    // forwarded to SimpleInput when `as` includes "SimpleInput"
    editorProps?: Record<string, unknown>
    headerActions?: React.ReactNode
    onMarkdownToggleReady?: (toggle: (() => void) | null) => void
    collapsed?: boolean
    /** Ref attached to the outer container — used for overflow detection by CollapseToggleButton */
    containerRef?: React.RefObject<HTMLDivElement | null>
}

const MarkdownToggleRegistrar: React.FC<{
    onMarkdownToggleReady?: (toggle: (() => void) | null) => void
}> = ({onMarkdownToggleReady}) => {
    const [editor] = useLexicalComposerContext()
    const callbackRef = useRef<typeof onMarkdownToggleReady>(onMarkdownToggleReady)
    const toggleRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        callbackRef.current = onMarkdownToggleReady
    }, [onMarkdownToggleReady])

    useEffect(() => {
        toggleRef.current = () => editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)
        callbackRef.current?.(toggleRef.current)

        return () => {
            callbackRef.current?.(null)
            toggleRef.current = null
        }
    }, [editor])

    return null
}

/**
 * Shared header for all variable control types.
 * Renders the variable name label and optional header actions.
 */
const VariableHeader: React.FC<{
    name: string | undefined
    headerActions?: React.ReactNode
}> = ({name, headerActions}) => (
    <div className="w-full flex items-start justify-between gap-2">
        <Typography className="playground-property-control-label font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono">
            {name}
        </Typography>
        {headerActions ? (
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                {headerActions}
            </div>
        ) : null}
    </div>
)

/**
 * VariableControlAdapter
 *
 * Adapter for rendering and editing generation variables using schema-aware
 * controls. Reads input port schema to select the appropriate editor:
 * - object/array → JSON code editor (SharedEditor with codeOnly)
 * - number/integer → InputNumber
 * - boolean → Switch
 * - string (default) → SharedEditor (rich text)
 */
const VariableControlAdapter: React.FC<VariableControlAdapterProps> = ({
    rowId,
    variableKey,
    className,
    as = "SimpleInput",
    view,
    placeholder,
    disabled,
    appType,
    editorProps,
    headerActions,
    onMarkdownToggleReady,
    collapsed = false,
    containerRef,
}) => {
    // Direct testcase entity access — rowId IS the testcaseId.
    // Uses testcaseMolecule.atoms.cell under the hood (selectAtom with equality check),
    // so this only re-renders when this specific cell value changes.
    const value = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.testcaseCellValue({
                    testcaseId: rowId,
                    column: variableKey,
                }),
            [rowId, variableKey],
        ),
    ) as string
    const variableKeys = useAtomValue(executionItemController.selectors.variableKeys) as string[]
    const name = useMemo(
        () => (variableKeys.includes(variableKey) ? variableKey : undefined),
        [variableKeys, variableKey],
    )

    // Schema-aware type detection from input port definitions
    const schemaMap = useAtomValue(executionItemController.selectors.inputPortSchemaMap) as Record<
        string,
        {type: string; schema?: unknown}
    >
    const portType = schemaMap[variableKey]?.type ?? "string"

    // Custom app variable gating: disable controls for names not in schema keys
    const schemaKeys = useAtomValue(
        useMemo(() => executionItemController.selectors.schemaInputKeys, []),
    ) as string[]
    const isCustom = appType === "custom"
    const disableForCustom = useMemo(() => {
        const allowedSet = new Set(Array.isArray(schemaKeys) ? schemaKeys : [])
        return Boolean(isCustom && name && !allowedSet.has(name as string))
    }, [isCustom, schemaKeys, name])

    const setCellValue = useSetAtom(executionItemController.actions.setTestcaseCellValue)

    // For object/array types, provide a sensible default when value is empty
    const isJsonType = portType === "object" || portType === "array"
    const jsonDefault = portType === "array" ? "[]" : "{}"
    const effectiveValue = isJsonType && (!value || value === "") ? jsonDefault : value

    // Seed the default back to the store so the execution payload has the correct value
    useEffect(() => {
        if (isJsonType && (!value || value === "")) {
            setCellValue({testcaseId: rowId, column: variableKey, value: jsonDefault})
        }
    }, [isJsonType, value, jsonDefault, setCellValue, rowId, variableKey])

    const handleChange = useCallback(
        (nextText: unknown) => {
            const nextVal = typeof nextText === "string" ? nextText : String(nextText ?? "")
            setCellValue({testcaseId: rowId, column: variableKey, value: nextVal})
        },
        [setCellValue, rowId, variableKey],
    )

    const {isComparisonView} = useAtomValue(
        useMemo(() => playgroundController.selectors.playgroundLayout(), []),
    )
    const viewType = isComparisonView ? "comparison" : "single"

    const effectivePlaceholder = placeholder || "Enter a value"
    const editorId = useMemo(
        () => `generation-variable-${rowId}-${variableKey}`,
        [rowId, variableKey],
    )

    const isEffectivelyDisabled = disabled || disableForCustom

    // Number/integer type → InputNumber
    if (portType === "number" || portType === "integer") {
        const numValue = value !== "" && value != null ? Number(value) : undefined
        return (
            <div ref={containerRef} style={getCollapseStyle(collapsed)}>
                <div
                    className={clsx(
                        "relative flex flex-col gap-1 p-[11px] rounded-lg border border-solid",
                        viewType === "single" && view !== "focus"
                            ? "border-[#BDC7D1]"
                            : "border-transparent bg-transparent",
                        className,
                    )}
                >
                    <VariableHeader name={name} headerActions={headerActions} />
                    <InputNumber
                        value={numValue != null && !isNaN(numValue) ? numValue : undefined}
                        onChange={(v) => handleChange(v != null ? String(v) : "")}
                        disabled={isEffectivelyDisabled}
                        placeholder={effectivePlaceholder}
                        className="w-full"
                        size="small"
                    />
                </div>
            </div>
        )
    }

    // Boolean type → Switch
    if (portType === "boolean") {
        return (
            <div ref={containerRef} style={getCollapseStyle(collapsed)}>
                <div
                    className={clsx(
                        "relative flex flex-col gap-1 p-[11px] rounded-lg border border-solid",
                        viewType === "single" && view !== "focus"
                            ? "border-[#BDC7D1]"
                            : "border-transparent bg-transparent",
                        className,
                    )}
                >
                    <VariableHeader name={name} headerActions={headerActions} />
                    <Switch
                        checked={value === "true"}
                        onChange={(checked) => handleChange(String(checked))}
                        disabled={isEffectivelyDisabled}
                        size="small"
                        className="w-fit"
                    />
                </div>
            </div>
        )
    }

    // Object/array types → JSON code editor
    const mergedEditorProps = isJsonType
        ? {codeOnly: true, language: "json", enableResize: false, boundWidth: true, ...editorProps}
        : {enableResize: false, boundWidth: true, ...editorProps}

    return (
        <div ref={containerRef} style={getCollapseStyle(collapsed)}>
            <EditorProvider
                id={editorId}
                initialValue={effectiveValue}
                placeholder={effectivePlaceholder}
                showToolbar={false}
                codeOnly={isJsonType || !!editorProps?.codeOnly}
                language={isJsonType ? "json" : undefined}
                enableTokens={!isJsonType && !editorProps?.codeOnly}
                disabled={isEffectivelyDisabled}
            >
                <MarkdownToggleRegistrar onMarkdownToggleReady={onMarkdownToggleReady} />
                <SharedEditor
                    id={editorId}
                    noProvider
                    header={<VariableHeader name={name} headerActions={headerActions} />}
                    key={variableKey}
                    editorType={viewType === "single" && view !== "focus" ? "border" : "borderless"}
                    useAntdInput={false}
                    disableContainerTransition
                    handleChange={handleChange}
                    initialValue={effectiveValue}
                    editorClassName={className}
                    placeholder={effectivePlaceholder}
                    disabled={isEffectivelyDisabled}
                    className={clsx(
                        "relative flex flex-col gap-1 rounded-[theme(spacing.2)]",
                        viewType === "single" && view !== "focus" ? "" : "bg-transparent",
                        isJsonType && "!pt-[11px] !pb-0 [&_.agenta-editor-wrapper]:!mb-0",
                        className,
                    )}
                    editorProps={mergedEditorProps}
                />
            </EditorProvider>
        </div>
    )
}

export default VariableControlAdapter
