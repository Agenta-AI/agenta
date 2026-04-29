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

    // Schema-aware type detection from input port definitions — also source of
    // the display label so path-style variable keys (`$.inputs.country`,
    // `/inputs/country`, `inputs.country`) render as their last segment instead
    // of the raw path. The key stays unchanged for request-payload identity.
    const schemaMap = useAtomValue(executionItemController.selectors.inputPortSchemaMap) as Record<
        string,
        {type: string; name?: string; schema?: unknown}
    >
    const portType = schemaMap[variableKey]?.type ?? "string"
    const portSchema = schemaMap[variableKey]?.schema
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

    // For object/array types, provide a sensible default when value is empty.
    // For grouped envelope-path variables (e.g. `$.inputs.test.country`), the
    // port carries a synthetic schema listing the known sub-keys — seed the
    // default JSON with those keys so users see which fields the template
    // references without having to re-read the prompt.
    const isJsonType = portType === "object" || portType === "array"
    const jsonDefault = useMemo(() => {
        if (portType === "array") return "[]"
        const props =
            portSchema && typeof portSchema === "object"
                ? (portSchema as {properties?: Record<string, unknown>}).properties
                : null
        if (!props || typeof props !== "object") return "{}"
        const keys = Object.keys(props)
        if (keys.length === 0) return "{}"
        const obj: Record<string, string> = {}
        for (const k of keys) obj[k] = ""
        return JSON.stringify(obj, null, 2)
    }, [portType, portSchema])

    // Detect whether the value looks like JSON. Derived during render (no
    // useState + useEffect indirection) so the mode is correct on the very
    // first render after a paste/edit — avoids a flicker where the content
    // briefly appears in the wrong editor before an effect-driven sync runs.
    //
    // Sticky during character-by-character edits: once detected as JSON, a
    // single-keystroke change that transiently breaks the JSON shape (e.g.
    // deleting the closing `}`) keeps the editor in JSON mode rather than
    // remounting Lexical mid-edit. Bulk replacements (paste, Cmd+A+Delete,
    // programmatic resets) skip stickiness because their length delta exceeds
    // 1 — they re-detect freshly from the new value.
    //
    // The EditorProvider downstream is keyed on this flag, so every flip
    // triggers a clean Lexical remount (avoiding the MarkdownShortcuts
    // dependency crash that earlier blocked downgrades on the same instance).
    const valStr = typeof value === "string" ? value : ""
    const prevValueRef = useRef<string>("")
    const prevDetectedRef = useRef<boolean>(false)
    let detectedAsJson: boolean
    if (!valStr) {
        detectedAsJson = false
    } else if (isJsonString(valStr)) {
        detectedAsJson = true
    } else {
        const isCharEdit = Math.abs(valStr.length - prevValueRef.current.length) <= 1
        detectedAsJson = isCharEdit && prevDetectedRef.current
    }
    useEffect(() => {
        prevValueRef.current = valStr
        prevDetectedRef.current = detectedAsJson
    })

    const isJsonEditor = isJsonType || detectedAsJson
    const isCellEmpty = !value || value === ""
    const effectiveValue = isJsonEditor && isJsonType && isCellEmpty ? jsonDefault : value

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

    // `jsonDefault` is a VISUAL hint only — never written back to the cell.
    // Earlier, we seeded the cell so the payload reflected the displayed shape,
    // but that broke real-time sync: once the cell held the stale seed, later
    // schema changes (user typed through a variable name, or added a new
    // sub-path) wouldn't re-seed. The editor would freeze on the first seed.
    //
    // Trade-off: if the user never types and hits Run, the cell is empty and
    // the payload won't carry the displayed JSON. Acceptable under the current
    // "UI is honest about shape, payload untouched" scope — runtime resolution
    // of JSONPath variables is broken either way until path-aware payload
    // routing lands.

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
                // Stable across user keystrokes (cell value changes don't
                // remount — preserves cursor position). Flips only when the
                // port's schema changes, which happens when the prompt
                // introduces new sub-paths or a different envelope root.
                key={`${editorId}-${isJsonEditor}-${schemaKey}`}
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
