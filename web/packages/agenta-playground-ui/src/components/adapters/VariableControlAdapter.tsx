import React, {useCallback, useEffect, useLayoutEffect, useMemo, useState} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {getCollapseStyle} from "@agenta/ui/components/presentational"
import {getViewOptions, ViewModeDropdown, type ViewMode} from "@agenta/ui/drill-in"
import {
    DrillInProvider,
    EditorProvider,
    SET_MARKDOWN_VIEW,
    useLexicalComposerContext,
} from "@agenta/ui/editor"
import type {EditorProps} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import type {ChipVariant} from "@agenta/ui/type-chip"
import {Info} from "@phosphor-icons/react"
import {InputNumber, Switch, Tooltip, Typography} from "antd"
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
    editorProps?: EditorProps
    headerActions?: React.ReactNode
    collapsed?: boolean
    /** Ref attached to the outer container — used for overflow detection by CollapseToggleButton */
    containerRef?: React.RefObject<HTMLDivElement | null>
    /** When true, hides the variable name label (useful when an outer wrapper already shows it) */
    hideLabel?: boolean
}

/**
 * Shared header for all variable control types.
 * Renders the variable name label, an optional info-tooltip explaining what
 * the variable represents, and any header actions (JSON/text toggle, copy,
 * markdown toggle, collapse) on the right.
 *
 * The info icon lives on the left next to the name — not in the right-hand
 * action cluster — so it stays visible (no hover-gate) without conflicting
 * with the hover-revealed action buttons. It's only rendered when the port
 * carries a `helpText` (currently set by `buildEvaluatorEnvelopePorts` to
 * distinguish evaluator envelope variables from app field variables).
 */
const VariableHeader: React.FC<{
    name: string | undefined
    headerActions?: React.ReactNode
    helpText?: string
    typeChip?: React.ReactNode
}> = ({name, headerActions, helpText, typeChip}) => (
    <div className="w-full flex items-start justify-between gap-2">
        <div className="flex items-center gap-1 min-w-0">
            <Typography className="playground-property-control-label font-[500] text-[12px] leading-[20px] text-[var(--ag-c-1677FF)] font-mono truncate">
                {name}
            </Typography>
            {typeChip}
            {helpText ? (
                <Tooltip title={helpText} placement="topLeft" overlayStyle={{maxWidth: 360}}>
                    <Info
                        size={12}
                        className="text-gray-400 hover:text-gray-600 shrink-0 cursor-help"
                        aria-label={`About ${name ?? "this variable"}`}
                    />
                </Tooltip>
            ) : null}
        </div>
        {headerActions ? (
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                {headerActions}
            </div>
        ) : null}
    </div>
)

const MarkdownViewSynchronizer: React.FC<{enabled: boolean}> = ({enabled}) => {
    const [editor] = useLexicalComposerContext()

    useLayoutEffect(() => {
        editor.dispatchCommand(SET_MARKDOWN_VIEW, enabled)
    }, [editor, enabled])

    useEffect(() => {
        const frameId = requestAnimationFrame(() => {
            editor.dispatchCommand(SET_MARKDOWN_VIEW, enabled)
        })
        return () => cancelAnimationFrame(frameId)
    }, [editor, enabled])

    return null
}

/**
 * Inline JSON/YAML code editor used by the schema-typed branch of
 * `VariableControlAdapter`. It mirrors `JsonEditorWithLocalState`'s
 * composition (EditorProvider wrapping SharedEditor with line numbers,
 * disabled long text, syncWithInitialValueChanges, and local state that
 * swallows invalid JSON instead of propagating it), while accepting header
 * and footer slots for the standard variable chrome and schema hint.
 */
const JsonVariableEditor: React.FC<{
    editorKey: string
    initialValue: string
    onValidChange: (value: string) => void
    language: "json" | "yaml"
    readOnly?: boolean
    header?: React.ReactNode
    footer?: React.ReactNode
    containerRef?: React.RefObject<HTMLDivElement | null>
    collapsed?: boolean
    placeholder?: string
}> = ({
    editorKey,
    initialValue,
    onValidChange,
    language,
    readOnly,
    header,
    footer,
    containerRef,
    collapsed,
    placeholder,
}) => {
    const [localValue, setLocalValue] = useState(initialValue)

    useEffect(() => {
        setLocalValue(initialValue)
    }, [initialValue])

    const handleChange = useCallback(
        (value: string) => {
            setLocalValue(value)
            if (language === "yaml") {
                onValidChange(value)
                return
            }
            try {
                JSON.parse(value)
                onValidChange(value)
            } catch {
                // Invalid JSON — keep local state but don't sync to parent.
            }
        },
        [language, onValidChange],
    )

    return (
        <div
            ref={containerRef}
            className="w-full flex flex-col gap-1"
            style={collapsed ? getCollapseStyle(collapsed) : undefined}
        >
            <DrillInProvider value={{enabled: false, decodeEscapedJsonStrings: false}}>
                <EditorProvider key={editorKey} codeOnly language={language} showToolbar={false}>
                    <SharedEditor
                        key={`${editorKey}-shared`}
                        initialValue={localValue}
                        handleChange={readOnly ? undefined : handleChange}
                        // Pass the header THROUGH SharedEditor so it renders
                        // inside the bordered container — matches the string
                        // branch's layout exactly. Rendering the header in a
                        // sibling div above the editor produces the "label
                        // outside, body inside" visual the user flagged as
                        // inconsistent with the other variable rows.
                        header={header}
                        placeholder={placeholder}
                        editorType="border"
                        // Match the string-branch JSON spacing (`!pt-[11px]
                        // !pb-0 [&_.agenta-editor-wrapper]:!mb-0`) so the
                        // label's top offset is identical to the text-editor
                        // case. Without these overrides the header sits
                        // slightly higher in the JSON branch.
                        className="min-h-[60px] overflow-hidden !pt-[11px] !pb-0 [&_.agenta-editor-wrapper]:!mb-0"
                        disableDebounce
                        noProvider
                        syncWithInitialValueChanges
                        disabled={readOnly}
                        state={readOnly ? "readOnly" : undefined}
                        editorProps={{
                            codeOnly: true,
                            language,
                            showLineNumbers: true,
                            disableLongText: true,
                        }}
                    />
                </EditorProvider>
            </DrillInProvider>
            {footer}
        </div>
    )
}

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
    collapsed = false,
    containerRef,
    hideLabel,
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

    // Schema-aware type detection from input port definitions — also source of
    // the display label so path-style variable keys (`$.inputs.country`,
    // `/inputs/country`, `inputs.country`) render as their last segment instead
    // of the raw path. The key stays unchanged for request-payload identity.
    const schemaMap = useAtomValue(executionItemController.selectors.inputPortSchemaMap) as Record<
        string,
        {type: string; name?: string; schema?: unknown; helpText?: string}
    >
    const declaredPortType = schemaMap[variableKey]?.type ?? "string"
    const portSchema = schemaMap[variableKey]?.schema
    const helpText = schemaMap[variableKey]?.helpText

    const isStructuredPort = declaredPortType === "object" || declaredPortType === "array"
    const [viewMode, setViewMode] = useState<ViewMode>("text")
    const supportsViewMode =
        declaredPortType === "string" ||
        declaredPortType === "object" ||
        declaredPortType === "array"
    const isCodeEditor = viewMode === "json" || viewMode === "yaml"

    const name = useMemo(
        () =>
            variableKeys.includes(variableKey)
                ? (schemaMap[variableKey]?.name ?? variableKey)
                : undefined,
        [variableKeys, variableKey, schemaMap],
    )

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

    // For object/array types, derive an "expected shape" hint from the port's
    // synthetic schema. For grouped envelope-path variables (e.g.
    // `$.inputs.test.country`) the schema lists the known sub-keys; rendered
    // outside the editor as help text so the user can see which fields the
    // template references without us pre-filling the editor with content
    // that won't actually be submitted.
    const shapeHint = useMemo(() => {
        if (declaredPortType === "array") return null
        const props =
            portSchema && typeof portSchema === "object"
                ? (portSchema as {properties?: Record<string, unknown>}).properties
                : null
        if (!props || typeof props !== "object") return null
        const keys = Object.keys(props)
        if (keys.length === 0) return null
        const obj: Record<string, string> = {}
        for (const k of keys) obj[k] = ""
        return JSON.stringify(obj)
    }, [declaredPortType, portSchema])

    const isCellEmpty = !value || value === ""
    // The editor reflects the actual cell content. Earlier the empty cell was
    // back-filled with a schema-derived default for display only, but that
    // looked populated while the run payload stayed empty — surface the
    // expected shape as a help-text hint instead (see `shapeHint` below).
    const effectiveValue = value

    // Identity key for remounting the editor on SCHEMA changes only.
    // Using `isCellEmpty` here (earlier approach) caused a cursor reset on
    // the first keystroke: the cell flipped non-empty mid-edit, the editor
    // key changed, Lexical remounted. Anchoring on the schema instead keeps
    // the key stable across typing and only flips when the prompt itself
    // introduces a new shape (different sub-paths, different slot).
    const schemaKey = useMemo(() => {
        if (!portSchema) return "no-schema"
        try {
            return JSON.stringify(portSchema)
        } catch {
            return "schema-err"
        }
    }, [portSchema])

    // The expected-shape hint is rendered as separate help text (not as the
    // editor's initial value). Earlier the seed was the editor's content,
    // which made empty cells look populated while the run payload stayed
    // empty. Showing the shape outside the editor keeps the editor honest
    // about what's submitted while still letting the user see which fields
    // the template references.

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

    const viewOptions = useMemo(
        () => (supportsViewMode ? getViewOptions(value ?? "") : []),
        [supportsViewMode, value],
    )
    const typeChipVariant = useMemo<ChipVariant | undefined>(() => {
        if (declaredPortType === "object") return "json-object"
        if (declaredPortType === "array") return "json-array"
        return undefined
    }, [declaredPortType])
    const typeChip = supportsViewMode ? (
        <TypeChip variant={typeChipVariant} value={typeChipVariant ? undefined : value} />
    ) : null
    const composedHeaderActions = useMemo(() => {
        const dropdown = supportsViewMode ? (
            <ViewModeDropdown
                key="view-mode"
                value={viewMode}
                options={viewOptions}
                onChange={setViewMode}
            />
        ) : null
        if (!dropdown) return headerActions
        if (!headerActions) return dropdown
        return (
            <>
                {dropdown}
                {headerActions}
            </>
        )
    }, [headerActions, supportsViewMode, viewMode, viewOptions])

    // Number/integer type → InputNumber
    if (declaredPortType === "number" || declaredPortType === "integer") {
        const numValue = value !== "" && value != null ? Number(value) : undefined
        return (
            <div ref={containerRef} className="w-full" style={getCollapseStyle(collapsed)}>
                <div
                    className={clsx(
                        "relative flex flex-col gap-1",
                        hideLabel
                            ? "p-0"
                            : clsx(
                                  "p-[11px] rounded-lg border border-solid",
                                  viewType === "single" && view !== "focus"
                                      ? "border-[var(--ag-c-BDC7D1)]"
                                      : "border-transparent bg-transparent",
                              ),
                        className,
                    )}
                >
                    {!hideLabel && (
                        <VariableHeader
                            name={name}
                            headerActions={composedHeaderActions}
                            helpText={helpText}
                        />
                    )}
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
    if (declaredPortType === "boolean") {
        return (
            <div ref={containerRef} className="w-full" style={getCollapseStyle(collapsed)}>
                <div
                    className={clsx(
                        "relative flex flex-col gap-1",
                        hideLabel
                            ? "p-0"
                            : clsx(
                                  "p-[11px] rounded-lg border border-solid",
                                  viewType === "single" && view !== "focus"
                                      ? "border-[var(--ag-c-BDC7D1)]"
                                      : "border-transparent bg-transparent",
                              ),
                        className,
                    )}
                >
                    {!hideLabel && (
                        <VariableHeader
                            name={name}
                            headerActions={composedHeaderActions}
                            helpText={helpText}
                        />
                    )}
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

    const mergedEditorProps: EditorProps = {
        enableResize: false,
        boundWidth: true,
        ...editorProps,
    }

    // Show the schema-derived shape as help text on empty object cells, so
    // the user knows which fields the template references without us
    // pre-filling the editor with a value that wouldn't get submitted.
    const showShapeHint = isStructuredPort && isCodeEditor && isCellEmpty && !!shapeHint

    // We deliberately keep the parent's `className` away from this branch —
    // generation rows pass `*:!border-none overflow-hidden` for the rich-text
    // cell strip, and applying it here strips the SharedEditor's own border
    // and the line-number gutter.
    if (isCodeEditor) {
        const codeLanguage = viewMode as "json" | "yaml"
        return (
            <JsonVariableEditor
                editorKey={`${editorId}-${codeLanguage}-${schemaKey}`}
                initialValue={effectiveValue ?? ""}
                onValidChange={handleChange}
                language={codeLanguage}
                readOnly={isEffectivelyDisabled}
                placeholder={effectivePlaceholder}
                header={
                    !hideLabel ? (
                        <VariableHeader
                            name={name}
                            headerActions={composedHeaderActions}
                            helpText={helpText}
                            typeChip={typeChip}
                        />
                    ) : null
                }
                footer={
                    showShapeHint ? (
                        <Typography.Text
                            type="secondary"
                            className="block mt-1 px-1 text-[11px] font-mono"
                        >
                            Expected shape: <code>{shapeHint}</code>
                        </Typography.Text>
                    ) : null
                }
                containerRef={containerRef}
                collapsed={collapsed}
            />
        )
    }

    return (
        <div ref={containerRef} className="w-full" style={getCollapseStyle(collapsed)}>
            <EditorProvider
                // Stable across user keystrokes (cell value changes don't
                // remount — preserves cursor position). Flips only when the
                // port's schema changes, which happens when the prompt
                // introduces new sub-paths or a different envelope root.
                key={`${editorId}-${viewMode}-${schemaKey}`}
                id={editorId}
                initialValue={effectiveValue}
                placeholder={effectivePlaceholder}
                showToolbar={false}
                codeOnly={!!editorProps?.codeOnly}
                enableTokens={!editorProps?.codeOnly}
                disabled={isEffectivelyDisabled}
            >
                <MarkdownViewSynchronizer enabled={viewMode === "markdown"} />
                <SharedEditor
                    id={editorId}
                    noProvider
                    header={
                        !hideLabel ? (
                            <VariableHeader
                                name={name}
                                headerActions={composedHeaderActions}
                                helpText={helpText}
                                typeChip={typeChip}
                            />
                        ) : undefined
                    }
                    key={variableKey}
                    editorType={
                        hideLabel
                            ? "borderless"
                            : viewType === "single" && view !== "focus"
                              ? "border"
                              : "borderless"
                    }
                    useAntdInput={false}
                    disableContainerTransition
                    handleChange={handleChange}
                    initialValue={effectiveValue}
                    value={effectiveValue}
                    editorClassName={className}
                    placeholder={effectivePlaceholder}
                    disabled={isEffectivelyDisabled}
                    className={clsx(
                        "relative flex flex-col gap-1 rounded-[theme(spacing.2)]",
                        hideLabel
                            ? "!p-0 !border-none bg-transparent"
                            : viewType === "single" && view !== "focus"
                              ? ""
                              : "bg-transparent",
                        className,
                    )}
                    editorProps={mergedEditorProps}
                />
            </EditorProvider>
            {showShapeHint && (
                <Typography.Text type="secondary" className="block mt-1 px-1 text-[11px] font-mono">
                    Expected shape: <code>{shapeHint}</code>
                </Typography.Text>
            )}
        </div>
    )
}

export default VariableControlAdapter
