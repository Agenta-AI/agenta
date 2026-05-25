import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import {getCollapseStyle} from "@agenta/ui/components/presentational"
import {
    DrillInProvider,
    TOGGLE_MARKDOWN_VIEW,
    EditorProvider,
    $getRoot,
    $isCodeBlockNode,
    $createCodeBlockNode,
    createHighlightedNodes,
    $wrapLinesInSegments,
    useLexicalComposerContext,
} from "@agenta/ui/editor"
import type {EditorProps} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Code, Info, TextAa} from "@phosphor-icons/react"
import {Button, InputNumber, Switch, Tooltip, Typography} from "antd"
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
}> = ({name, headerActions, helpText}) => (
    <div className="w-full flex items-start justify-between gap-2">
        <div className="flex items-center gap-1 min-w-0">
            <Typography className="playground-property-control-label font-[500] text-[12px] leading-[20px] text-[#1677FF] font-mono truncate">
                {name}
            </Typography>
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

/**
 * Inline JSON code editor used by the schema-typed branch of
 * `VariableControlAdapter`. Mirrors `JsonEditorWithLocalState`'s composition
 * exactly (EditorProvider with codeOnly+json wrapping SharedEditor with
 * showLineNumbers, disableLongText, syncWithInitialValueChanges, and local
 * state that swallows invalid JSON instead of propagating it) — but accepts
 * a `header` slot so we can render the standard `VariableHeader` (blue mono
 * label + action buttons) above the editor surface, and a `footer` slot for
 * the schema shape hint.
 */
/**
 * Seeds the JSON editor with a 3-line `{ \n \n }` skeleton on mount so an
 * empty cell visually invites the user to type fields inside the braces
 * instead of presenting a blank box. The cell value tracks the editor's
 * onChange — once the editor renders `"{\n\n}"`, the cell value matches,
 * which parses to `{}` at submission (the SDK's `parseIfJsonObject`
 * round-trips identically).
 *
 * Why we don't use `INITIAL_CONTENT_COMMAND`: that handler runs
 * `JSON.stringify(JSON5.parse(content), null, 2)` on language=json
 * payloads. An empty object stringifies to single-line `"{}"`, collapsing
 * the multi-line skeleton. We build the Lexical node tree directly to
 * preserve the exact visual.
 *
 * Deferred to the next animation frame because this component mounts as
 * a sibling of `SharedEditor`. React fires sibling effects in document
 * order, so a synchronous edit here would run before `SharedEditor` had
 * a chance to initialize the Lexical state. Deferring lets the editor
 * settle first.
 *
 * Mounted as a sibling plugin inside the JSON editor's `EditorProvider`.
 * Fires once per editor instance.
 */
const EmptyCodeBlockSeed: React.FC<{shouldSeed: boolean}> = ({shouldSeed}) => {
    const [editor] = useLexicalComposerContext()
    const seededRef = useRef(false)
    useEffect(() => {
        if (!shouldSeed || seededRef.current) return
        let cancelled = false
        let attempts = 0
        const maxAttempts = 10
        const trySeed = () => {
            if (cancelled || seededRef.current) return
            attempts += 1
            let seeded = false
            editor.update(() => {
                const root = $getRoot()
                // Bail when the editor already holds *non-empty* user
                // content — we never clobber typed JSON. But the
                // CodeEditorPlugin may have already created a single-line
                // `{}` CodeBlockNode from the stale `"{}"` initial value
                // before our deferred effect runs; that block parses to an
                // empty object and we *do* want to replace it with the
                // 3-line skeleton. The `shouldSeed` gate upstream already
                // confirmed the cell is effectively empty (either truly
                // empty or `{}`-equivalent), so reaching here means it's
                // safe to rebuild.
                const existing = root.getChildren().find($isCodeBlockNode)
                if (existing) {
                    const text = existing.getTextContent().trim()
                    if (text) {
                        try {
                            const parsed = JSON.parse(text)
                            const isEmptyObject =
                                parsed &&
                                typeof parsed === "object" &&
                                !Array.isArray(parsed) &&
                                Object.keys(parsed).length === 0
                            if (!isEmptyObject) {
                                seeded = true
                                return
                            }
                        } catch {
                            // Invalid JSON the user typed — don't clobber.
                            seeded = true
                            return
                        }
                    }
                }
                root.clear()
                const codeBlock = $createCodeBlockNode("json")
                // Use the editor's own `createHighlightedNodes` helper so the
                // resulting `CodeLineNode`s contain properly-tokenized
                // `CodeHighlightNode` + `CodeTabNode` children. A naive
                // `$createTextNode` approach renders the right glyphs but
                // the syntax-highlight transform pipeline doesn't recognise
                // plain `TextNode`s as canonical code content and ends up
                // pruning my middle/close lines on the next tick.
                //
                // `createHighlightedNodes` skips its JSON reformat path
                // when the input has `\n  ` (multi-line indent), so the
                // 3-line skeleton survives intact. The two-space indent on
                // the middle line becomes a `CodeTabNode` so the user's
                // typed content lands nested inside the braces.
                const highlighted = createHighlightedNodes("{\n  \n}", "json", true)
                $wrapLinesInSegments(highlighted).forEach((node) => {
                    codeBlock.append(node)
                })
                root.append(codeBlock)
                seeded = true
            })
            if (seeded) {
                seededRef.current = true
                return
            }
            if (attempts < maxAttempts) {
                requestAnimationFrame(trySeed)
            } else {
                seededRef.current = true
            }
        }
        const id = requestAnimationFrame(trySeed)
        return () => {
            cancelled = true
            cancelAnimationFrame(id)
        }
    }, [editor, shouldSeed])
    return null
}

const JsonVariableEditor: React.FC<{
    editorKey: string
    initialValue: string
    onValidChange: (value: string) => void
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
    readOnly,
    header,
    footer,
    containerRef,
    collapsed,
    placeholder,
}) => {
    // Empty cells render with a 3-line `{ \n \n }` skeleton on mount via
    // `EmptyCodeBlockSeed` below — gives the user a JSON-shaped invitation
    // instead of a blank box. We previously seeded the cell *value* with
    // `"{}"` for the same purpose, but that surfaced as a single-line
    // artifact (QA: "Inputs always start with `{}`, why??"). The direct
    // Lexical mutation preserves the multi-line visual.
    //
    // "Effectively empty" covers both truly empty cells (no value yet) AND
    // cells whose value parses to an empty object/array. The latter happens
    // when a stale `"{}"` value is still in the testcase store from earlier
    // builds of this code; we want the new skeleton to apply there too,
    // not show single-line `{}` lingering from the old default. The cell
    // value then tracks the editor's onChange, becoming `"{\n\n}"` after
    // the seed runs — which parses to the same `{}` at submit time.
    const [localValue, setLocalValue] = useState(initialValue)
    const shouldSeedEmptyLine = useMemo(() => {
        if (!initialValue) return true
        try {
            const parsed = JSON.parse(initialValue)
            if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed) &&
                Object.keys(parsed).length === 0
            ) {
                return true
            }
        } catch {
            // Invalid JSON — leave alone; the user has content that doesn't
            // parse and we'd rather not clobber whatever they typed.
        }
        return false
    }, [initialValue])

    useEffect(() => {
        setLocalValue(initialValue)
    }, [initialValue])

    const handleChange = useCallback(
        (value: string) => {
            setLocalValue(value)
            try {
                JSON.parse(value)
                onValidChange(value)
            } catch {
                // Invalid JSON — keep local state but don't sync to parent.
            }
        },
        [onValidChange],
    )

    return (
        <div
            ref={containerRef}
            className="w-full flex flex-col gap-1"
            style={collapsed ? getCollapseStyle(collapsed) : undefined}
        >
            <DrillInProvider value={{enabled: false, decodeEscapedJsonStrings: false}}>
                <EditorProvider key={editorKey} codeOnly language="json" showToolbar={false}>
                    <EmptyCodeBlockSeed shouldSeed={shouldSeedEmptyLine} />
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
                            language: "json",
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
        {type: string; name?: string; schema?: unknown; helpText?: string}
    >
    const declaredPortType = schemaMap[variableKey]?.type ?? "string"
    const portSchema = schemaMap[variableKey]?.schema
    const helpText = schemaMap[variableKey]?.helpText

    // Explicit text/JSON toggle. The button lives in the variable header
    // (see `composedHeaderActions` below) and lets the user flip between
    // editor surfaces — JSON code editor (line numbers + syntax) vs. plain
    // text — for any port whose declared type is `string`, `object`, or
    // `array`. Both surfaces edit the same stored string value; the
    // runtime's `parseIfJsonObject` round-trips JSON-shaped strings either
    // way. We deliberately don't auto-detect from content: swapping
    // editors mid-keystroke yanks the user's caret.
    //
    // `forceMode` is the per-session user override. When unset, the
    // editor surface follows the declared port type: `object`/`array`
    // start in JSON; `string` starts as text. Numeric/boolean ports route
    // through dedicated controls (InputNumber/Switch) below and never
    // hit this toggle path.
    const [forceMode, setForceMode] = useState<"json" | "text" | null>(null)
    const declaredIsJson = declaredPortType === "object" || declaredPortType === "array"
    const declaredIsToggleable = declaredIsJson || declaredPortType === "string"
    const effectiveSurface: "json" | "text" = forceMode ?? (declaredIsJson ? "json" : "text")
    // `portType` retains the full type union for the number/boolean/array
    // branches below; we only override it when the user has explicitly
    // flipped the surface via the JSON/text toggle.
    const portType: string =
        forceMode === "json" ? "object" : forceMode === "text" ? "string" : declaredPortType
    const canToggleJson = declaredIsToggleable

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
    const isJsonType = portType === "object" || portType === "array"
    const shapeHint = useMemo(() => {
        if (portType === "array") return null
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
    }, [portType, portSchema])

    // Editor mode is controlled exclusively by `portType` (= the declared
    // port type, optionally overridden via the explicit JSON/text toggle
    // button in the header — see `forceMode` / `composedHeaderActions`).
    // The previous content-sniffing "sticky" behaviour (`detectedAsJson`
    // flip based on whether the value started with `{`/`[`) was removed
    // in favour of explicit user action so the editor never swaps out
    // from under the user mid-keystroke.
    const isJsonEditor = isJsonType
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

    // Intercept Cmd/Ctrl+A followed by Delete/Backspace — the most common
    // Content-driven mode-flip helpers (`handleKeyDownCapture`,
    // `handlePasteCapture`, `shouldFocusAfterMountRef`) were removed
    // alongside the `detectedAsJson` magic. Editor mode is now toggled only
    // by the explicit JSON/Text button in the header, so paste and select-
    // all-delete never need to bypass Lexical to coordinate a swap —
    // Lexical's own paste / keyboard handling is correct in single-mode.

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

    // Compose the variable header's actions: prepend our JSON/text toggle
    // ahead of whatever actions the parent passed in. Mirrors the markdown
    // toggle pattern from `ChatMessage` — explicit user control over the
    // editor surface, no content-sniffing magic. Visible for every port
    // type; clicking flips between JSON code editor (line numbers +
    // syntax) and plain text editor surfaces. Both edit the same stored
    // string value.
    const isCurrentlyJson = effectiveSurface === "json"
    const composedHeaderActions = useMemo(() => {
        if (!canToggleJson) return headerActions
        const toggle = (
            <Tooltip
                key="json-toggle"
                title={isCurrentlyJson ? "Switch to text editor" : "Switch to JSON editor"}
            >
                <Button
                    type="text"
                    size="small"
                    icon={isCurrentlyJson ? <TextAa size={14} /> : <Code size={14} />}
                    onClick={() => setForceMode(isCurrentlyJson ? "text" : "json")}
                    aria-label={
                        isCurrentlyJson
                            ? "Switch variable to text editor"
                            : "Switch variable to JSON editor"
                    }
                />
            </Tooltip>
        )
        if (!headerActions) return toggle
        return (
            <>
                {toggle}
                {headerActions}
            </>
        )
    }, [canToggleJson, isCurrentlyJson, headerActions])

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

    // Object/array types (and detected JSON strings) → JSON code editor
    const mergedEditorProps: EditorProps = isJsonEditor
        ? {codeOnly: true, language: "json", enableResize: false, boundWidth: true, ...editorProps}
        : {enableResize: false, boundWidth: true, ...editorProps}

    // Show the schema-derived shape as help text on empty object cells, so
    // the user knows which fields the template references without us
    // pre-filling the editor with a value that wouldn't get submitted.
    const showShapeHint = isJsonType && isCellEmpty && !!shapeHint

    // Schema-typed JSON (object/array): render the same editor stack the
    // DrillIn / Testcase JSON editors use — code-only Lexical with line
    // numbers and syntax highlighting. Inlined (not delegated to
    // `JsonEditorWithLocalState`) so we can preserve the variable header
    // and route the change handler through the testcase cell store directly.
    // The string-typed branch below stays as-is for detected-JSON sticky
    // mode flips, which only the rich-text editor surface supports.
    //
    // We deliberately keep the parent's `className` away from this branch —
    // generation rows pass `*:!border-none overflow-hidden` for the rich-text
    // cell strip, and applying it here strips the SharedEditor's own border
    // and the line-number gutter.
    if (isJsonType) {
        return (
            <JsonVariableEditor
                editorKey={editorId}
                initialValue={effectiveValue ?? ""}
                onValidChange={handleChange}
                readOnly={isEffectivelyDisabled}
                placeholder={effectivePlaceholder}
                header={
                    !hideLabel ? (
                        <VariableHeader
                            name={name}
                            headerActions={composedHeaderActions}
                            helpText={helpText}
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
                <MarkdownToggleRegistrar onMarkdownToggleReady={onMarkdownToggleReady} />
                <SharedEditor
                    id={editorId}
                    noProvider
                    header={
                        !hideLabel ? (
                            <VariableHeader
                                name={name}
                                headerActions={composedHeaderActions}
                                helpText={helpText}
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
                        isJsonEditor && "!pt-[11px] !pb-0 [&_.agenta-editor-wrapper]:!mb-0",
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
