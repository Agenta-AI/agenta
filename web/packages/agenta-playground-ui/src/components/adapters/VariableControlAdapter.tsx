import React, {useCallback, useEffect, useMemo, useRef} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {isJsonString} from "@agenta/shared/utils"
import {getCollapseStyle} from "@agenta/ui/components/presentational"
import {TOGGLE_MARKDOWN_VIEW, EditorProvider, useLexicalComposerContext} from "@agenta/ui/editor"
import type {EditorProps} from "@agenta/ui/editor"
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
    editorProps?: EditorProps
    headerActions?: React.ReactNode
    onMarkdownToggleReady?: (toggle: (() => void) | null) => void
    collapsed?: boolean
    /** Ref attached to the outer container — used for overflow detection by CollapseToggleButton */
    containerRef?: React.RefObject<HTMLDivElement | null>
    /** When true, hides the variable name label (useful when an outer wrapper already shows it) */
    hideLabel?: boolean
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
 * Focuses the Lexical editor on mount when `armedRef.current` is true, then
 * disarms. Used so that a mode-flip-triggered remount (paste or Cmd+A+Delete)
 * returns focus to the newly-mounted editor — preserving the user's editing
 * context across the swap.
 */
const FocusOnMountWhenArmed: React.FC<{
    armedRef: React.MutableRefObject<boolean>
}> = ({armedRef}) => {
    const [editor] = useLexicalComposerContext()
    useEffect(() => {
        if (!armedRef.current) return
        armedRef.current = false
        editor.focus()
    }, [editor, armedRef])
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

    // Detect whether the value looks like JSON. Derived directly from `value`
    // (no intermediate useState + useEffect) so the mode is correct on the very
    // first render after a paste/edit — avoids a flicker where the content
    // briefly appears in the wrong editor before the effect-driven sync kicks
    // in. The EditorProvider downstream is keyed on this flag, so every flip
    // triggers a clean Lexical remount (avoiding the MarkdownShortcuts
    // dependency crash that earlier blocked downgrades on the same instance).
    const detectedAsJson = typeof value === "string" && !!value && isJsonString(value)

    const isJsonEditor = isJsonType || detectedAsJson
    const effectiveValue =
        isJsonEditor && isJsonType && (!value || value === "") ? jsonDefault : value

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

    // Intercept Cmd/Ctrl+A followed by Delete/Backspace — the most common
    // "nuke everything and retype" flow — so the mode flip happens without
    // the old editor briefly painting its cleared state. We track a ref that
    // arms on select-all keydown and fires on the next delete/backspace.
    // Any other key resets the arm. This doesn't cover backspace-until-empty
    // (each keystroke individually can't reliably predict the final empty
    // state without reading editor internals), so that flow still flashes
    // for 1 frame — acceptable tradeoff for the uncommon path.
    const selectAllArmedRef = useRef(false)
    const handleKeyDownCapture = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const key = e.key.toLowerCase()
            if ((e.metaKey || e.ctrlKey) && key === "a") {
                selectAllArmedRef.current = true
                return
            }
            if (selectAllArmedRef.current && (key === "delete" || key === "backspace")) {
                selectAllArmedRef.current = false
                // Only preempt if the clear would actually flip the mode —
                // for plain-text cells already in text mode, let the editor
                // handle the delete normally (no flash to avoid).
                if (isJsonEditor) {
                    e.preventDefault()
                    e.stopPropagation()
                    shouldFocusAfterMountRef.current = true
                    handleChange("")
                }
                return
            }
            selectAllArmedRef.current = false
        },
        [handleChange, isJsonEditor],
    )

    // Armed when we take over an input action that causes a mode flip, so the
    // newly-mounted editor can steal focus back from the unmounted one. Without
    // this, any interception (paste, Cmd+A+Delete) that flips the mode would
    // leave the user without a focused editor — frustrating mid-edit.
    const shouldFocusAfterMountRef = useRef(false)

    // Intercept paste at the container (capture phase, before Lexical sees it)
    // when the pasted content would cause a mode flip (text ↔ JSON). The old
    // editor then never receives the paste event and never shows the pasted
    // content in the wrong mode — we route it straight to the cell, and the
    // EditorProvider remounts in the correct mode with the pasted value as
    // the initial content. For same-mode pastes we let the editor handle the
    // event normally so cursor/selection/IME behavior is preserved.
    const handlePasteCapture = useCallback(
        (e: React.ClipboardEvent<HTMLDivElement>) => {
            // Schema-typed fields (object/array) are pinned to JSON mode —
            // no paste can cause a mode flip, so let Lexical handle it normally
            // (preserves cursor position and avoids clobbering existing JSON).
            if (isJsonType) return
            const pasted = e.clipboardData?.getData("text")
            if (!pasted) return
            const pastedLooksLikeJson = isJsonString(pasted)
            if (pastedLooksLikeJson === detectedAsJson) return
            // Cross-mode paste — bypass the editor.
            e.preventDefault()
            e.stopPropagation()
            shouldFocusAfterMountRef.current = true
            handleChange(pasted)
        },
        [isJsonType, detectedAsJson, handleChange],
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
            <div ref={containerRef} className="w-full" style={getCollapseStyle(collapsed)}>
                <div
                    className={clsx(
                        "relative flex flex-col gap-1",
                        hideLabel
                            ? "p-0"
                            : clsx(
                                  "p-[11px] rounded-lg border border-solid",
                                  viewType === "single" && view !== "focus"
                                      ? "border-[#BDC7D1]"
                                      : "border-transparent bg-transparent",
                              ),
                        className,
                    )}
                >
                    {!hideLabel && <VariableHeader name={name} headerActions={headerActions} />}
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
            <div ref={containerRef} className="w-full" style={getCollapseStyle(collapsed)}>
                <div
                    className={clsx(
                        "relative flex flex-col gap-1",
                        hideLabel
                            ? "p-0"
                            : clsx(
                                  "p-[11px] rounded-lg border border-solid",
                                  viewType === "single" && view !== "focus"
                                      ? "border-[#BDC7D1]"
                                      : "border-transparent bg-transparent",
                              ),
                        className,
                    )}
                >
                    {!hideLabel && <VariableHeader name={name} headerActions={headerActions} />}
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

    // Object/array types (and detected JSON strings) → JSON code editor
    const mergedEditorProps: EditorProps = isJsonEditor
        ? {codeOnly: true, language: "json", enableResize: false, boundWidth: true, ...editorProps}
        : {enableResize: false, boundWidth: true, ...editorProps}

    return (
        <div
            ref={containerRef}
            className="w-full"
            style={getCollapseStyle(collapsed)}
            onPasteCapture={handlePasteCapture}
            onKeyDownCapture={handleKeyDownCapture}
        >
            <EditorProvider
                key={`${editorId}-${isJsonEditor}`}
                id={editorId}
                initialValue={effectiveValue}
                placeholder={effectivePlaceholder}
                showToolbar={false}
                codeOnly={isJsonEditor || !!editorProps?.codeOnly}
                language={isJsonEditor ? "json" : undefined}
                enableTokens={!isJsonEditor && !editorProps?.codeOnly}
                disabled={isEffectivelyDisabled}
            >
                <FocusOnMountWhenArmed armedRef={shouldFocusAfterMountRef} />
                <MarkdownToggleRegistrar onMarkdownToggleReady={onMarkdownToggleReady} />
                <SharedEditor
                    id={editorId}
                    noProvider
                    header={
                        !hideLabel ? (
                            <VariableHeader name={name} headerActions={headerActions} />
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
                        isJsonEditor && "!pt-[11px] !pb-0 [&_.agenta-editor-wrapper]:!mb-0",
                        className,
                    )}
                    editorProps={mergedEditorProps}
                />
            </EditorProvider>
        </div>
    )
}

export default VariableControlAdapter
