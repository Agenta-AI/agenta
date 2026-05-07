/**
 * PlaygroundExecutionItemCompact — third alternative for the playground
 * execution item, surfaced 2026-05-04 by alternative-design exploration.
 * Recovers the compactness of the very first iteration without losing
 * in-place editing.
 *
 * Each input is a single ~26px row: `caret + chip + name + 1-line preview`.
 * Click semantics:
 *   - Primitives (string/number/bool/null): row morphs in place — the preview
 *     swaps to <Input> / <InputNumber> / <Switch> at the same row height.
 *     Blur or Enter saves and reverts to preview.
 *   - Structured (object/array/messages/stringified): caret expands the row
 *     inline into an embedded ProposedDrillIn for that subtree. Collapse
 *     caret returns to the compact row.
 *
 * Design tradeoffs (be honest about both):
 *   + Wins: high density on chip-showcase / mostly-flat fixtures (~24px/row
 *     vs ~80px+/row in current Proposed). Typed-table aesthetic.
 *   - Loses: click-to-edit regression vs always-mounted <Input> in current
 *     Proposed. Deep nesting (depth-3+) makes the inline expansion render
 *     a worse-looking version of current Proposed mid-list.
 *
 * Output area + evaluator strip + run chrome are unchanged from
 * PlaygroundExecutionItem so the only delta is the inputs visual model.
 */

import {useId, useMemo, useState} from "react"
import type {CSSProperties} from "react"

import {ArrowClockwise, CaretDown, CaretRight, PencilSimple} from "@phosphor-icons/react"
import {Input, InputNumber, Switch} from "antd"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {MarkdownToggleButton} from "@agenta/ui"

import {ProposedDrillIn, type ChipRenderMode} from "./ProposedDrillIn"
import {ChipConversionPopover} from "./ChipConversionPopover"
import {TypeChip, type ChipVariant} from "./TypeChip"

interface InputField {
    name: string
    value: unknown
}

interface PlaygroundExecutionItemCompactProps {
    testcaseLabel: string
    inputs: InputField[]
    /**
     * Names of testcase columns the prompt chain doesn't reference. Rendered
     * as a peekable footer below the inputs body. See PlaygroundExecutionItem
     * for the rationale (Mahmoud SME-complexity feedback 2026-05-05).
     */
    unusedTestcaseColumns?: string[]
    output: unknown
    evaluators?: {name: string; score: number; passed: boolean}[]
    durationMs?: number
    chipMode?: ChipRenderMode
    editable?: boolean
}

type Kind =
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "object"
    | "array"
    | "messages"
    | "stringified"

// Helper for the preview format — a long/multi-line string deserves a
// "N chars · M lines · first-line preview" summary instead of a truncated
// single-line preview. This is preview-format only; it does NOT drive
// chip selection or editor mode (the user picks those via the chip popover).
function isLongFormString(v: string): boolean {
    return v.length > 100 || v.includes("\n")
}

function classifyKind(v: unknown): {
    kind: Kind
    chip: ChipVariant
    hint: ChipVariant | null
    parsed?: unknown
} {
    if (v === null) return {kind: "null", chip: "null", hint: null}
    if (Array.isArray(v)) {
        const isMsgs =
            v.length > 0 && v.every((x) => x && typeof x === "object" && "role" in (x as object))
        const isToolCalls =
            v.length > 0 &&
            v.every(
                (x) =>
                    x &&
                    typeof x === "object" &&
                    (x as {type?: unknown}).type === "function" &&
                    "function" in (x as object),
            )
        return isMsgs
            ? {kind: "messages", chip: "json-array", hint: "messages"}
            : isToolCalls
              ? {kind: "array", chip: "json-array", hint: "tool-calls"}
              : {kind: "array", chip: "json-array", hint: null}
    }
    if (typeof v === "object") return {kind: "object", chip: "json-object", hint: null}
    if (typeof v === "number") return {kind: "number", chip: "number", hint: null}
    if (typeof v === "boolean") return {kind: "boolean", chip: "boolean", hint: null}
    if (typeof v === "string") {
        if (v[0] === "{" || v[0] === "[") {
            try {
                const parsed = JSON.parse(v)
                if (parsed && typeof parsed === "object") {
                    return {
                        kind: "stringified",
                        chip: "string",
                        hint: "stringified",
                        parsed,
                    }
                }
            } catch {
                // not JSON
            }
        }
        // All strings classify as kind="string" regardless of length. The
        // editor mode (short inline vs long-form Lexical) is a separate
        // user-chosen dimension — clicking the chip + "Switch to long-form
        // editor" flips it. Length-based auto-detection conflated length
        // with user intent (markdown can be 30 chars; plain text can be
        // 5000), so we drop it.
        return {kind: "string", chip: "string", hint: null}
    }
    return {kind: "string", chip: "string", hint: null}
}

function renderPreview(v: unknown, kind: Kind, parsed?: unknown): string {
    if (v === undefined) return ""
    switch (kind) {
        case "null":
            return "null"
        case "boolean":
            return String(v)
        case "number":
            return String(v)
        case "string": {
            const s = String(v ?? "")
            // Long/multi-line content gets a richer summary. Length isn't
            // the chip signal but it IS the preview-format signal — a
            // 600-char paragraph shouldn't try to fit on a 26px row's tail.
            if (isLongFormString(s)) {
                const firstLine = s.split("\n").find((l) => l.trim().length > 0) ?? s
                const stripped = firstLine
                    .replace(/^#+\s*/, "")
                    .replace(/[*_`]/g, "")
                    .trim()
                const charCount = s.length
                const lineCount = s.split("\n").length
                const summary = `${charCount} chars · ${lineCount} line${lineCount === 1 ? "" : "s"}`
                const head = stripped.length > 60 ? stripped.slice(0, 57) + "…" : stripped
                return `${summary} · ${head}`
            }
            return s.length > 80 ? s.slice(0, 77) + "…" : s
        }
        case "stringified": {
            const p = parsed as object | unknown[] | undefined
            if (!p) return ""
            if (Array.isArray(p)) return `[ ${p.length} items ]`
            return `{ ${Object.keys(p as object).length} props }`
        }
        case "object":
            return `{ ${Object.keys((v as object) ?? {}).length} props }`
        case "array":
            return `[ ${((v as unknown[]) ?? []).length} items ]`
        case "messages": {
            const arr = (v as {role: string}[]) ?? []
            const roles = arr
                .slice(0, 3)
                .map((m) => m.role)
                .join(" + ")
            return `${arr.length} messages · ${roles}${arr.length > 3 ? "…" : ""}`
        }
    }
}

// chipMode="none" — style the preview text by type
function styledPreview(kind: Kind, value: unknown): CSSProperties {
    const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    if (kind === "number")
        return {
            fontFamily: mono,
            color: "#722ed1",
            fontVariantNumeric: "tabular-nums",
        }
    if (kind === "boolean")
        return {
            fontFamily: mono,
            color: value ? "#389e0d" : "#cf1322",
            fontWeight: 600,
        }
    if (kind === "null")
        return {
            fontFamily: mono,
            color: "rgba(5, 23, 41, 0.45)",
            fontStyle: "italic",
        }
    if (kind === "stringified")
        return {
            fontFamily: mono,
            color: "#1677ff",
            fontStyle: "italic",
            background: "#e6f4ff",
            padding: "1px 6px",
            borderRadius: 3,
            border: "1px dashed #1677ff",
        }
    if (kind === "object") return {fontFamily: mono, color: "#1677ff"}
    if (kind === "array") return {fontFamily: mono, color: "#13c2c2"}
    if (kind === "messages") return {fontFamily: mono, color: "#722ed1", fontWeight: 500}
    return {fontFamily: mono, color: "rgba(5, 23, 41, 0.75)"}
}

function shouldShowChip(chipMode: ChipRenderMode, kind: Kind): boolean {
    if (chipMode === "all") return true
    if (chipMode === "none") return false
    // ambiguous-only: hide for str/num/bool (widget already disambiguates)
    return kind !== "string" && kind !== "number" && kind !== "boolean"
}

function CompactRow({
    name,
    value,
    chipMode,
    editable,
}: {
    name: string
    value: unknown
    chipMode: ChipRenderMode
    editable: boolean
}) {
    const editorId = useId()
    const [editing, setEditing] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [draft, setDraft] = useState(value)
    // Classify off the live draft so the chip variant + value styling react
    // to type conversions (RFC WP-F1 round-trip — the chip IS the storage
    // signal). On prop changes, useState above re-initializes draft.
    const classified = useMemo(() => classifyKind(draft), [draft])
    // Editor-mode preference (short inline vs long-form Lexical). Initialized
    // ONCE at mount: if the hydrated value is already long-form (>100 chars or
    // contains newlines) we assume the user is dealing with markdown / a
    // multi-paragraph string, so default to "long". After that, the user's
    // explicit choice (chip popover) is the only thing that changes mode —
    // typing past the threshold does NOT auto-flip the editor and break focus.
    // Length isn't the signal at edit-time; it's just a sensible mount-time
    // assumption.
    const [forcedMode, setForcedMode] = useState<"short" | "long">(() =>
        typeof value === "string" && isLongFormString(value) ? "long" : "short",
    )
    const mode = forcedMode
    // When user explicitly switches to "long" via the chip popover, set this
    // flag so the SharedEditor mounts with autoFocus enabled — focus jumps
    // from the inline Input (or wherever) into the editor automatically so
    // they can keep typing. Cleared on next interaction. Initial-mount
    // hydration (forcedMode init via lazy useState) does NOT set this; we
    // only autofocus on user-driven transitions.
    const [autoFocusEditor, setAutoFocusEditor] = useState(false)
    // Resolve chips from classified kind + mode preference. Type primitive
    // is always one of {str, num, bool, null, obj, arr}. Render hint stacks
    // alongside when the value's render mode is non-default — markdown
    // (long-form string), stringified-JSON, messages, tool-calls.
    const isStringContent = classified.kind === "string"
    const chip: ChipVariant = classified.chip
    const renderHint: ChipVariant | null =
        isStringContent && mode === "long" ? "markdown" : classified.hint
    const kind = classified.kind
    const parsed = classified.parsed
    // Inline-morph-to-Input pattern only applies to *short* primitives in
    // short mode (string/number/boolean/null). Long-form strings (mode=long)
    // get the expandable-caret + Lexical SharedEditor treatment.
    const isShortPrimitive =
        (kind === "string" && mode === "short") ||
        kind === "number" ||
        kind === "boolean" ||
        kind === "null"
    // Once expanded (caret click), the row stays expandable so the user can
    // collapse manually. Long-form mode is always expandable.
    const isExpandable = !isShortPrimitive || expanded

    const showChip = shouldShowChip(chipMode, kind)
    const previewStyle = chipMode === "none" ? styledPreview(kind, draft) : styles.preview

    const onRowClick = () => {
        if (!editable) return
        if (isExpandable) setExpanded((x) => !x)
        else setEditing(true)
    }

    return (
        <div style={styles.rowOuter}>
            <div
                style={{
                    ...styles.row,
                    cursor: editable ? "pointer" : "default",
                }}
                onClick={editing ? undefined : onRowClick}
            >
                <span style={styles.caret}>
                    {isExpandable ? (
                        expanded ? (
                            <CaretDown size={12} />
                        ) : (
                            <CaretRight size={12} />
                        )
                    ) : (
                        <span style={{width: 14}} />
                    )}
                </span>
                {showChip ? (
                    <span onClick={(e) => e.stopPropagation()}>
                        <ChipConversionPopover
                            variant={chip}
                            value={draft}
                            editable={editable}
                            onConvert={(next) => setDraft(next)}
                            // Editor-mode toggle moves to the [markdown]
                            // chip when one is visible (per JP feedback
                            // 2026-05-05). The type chip keeps mode-switching
                            // as a fallback when no render hint exists.
                            onModeSwitch={
                                isStringContent && renderHint !== "markdown"
                                    ? (next) => {
                                          setForcedMode(next)
                                          if (next === "long") {
                                              setEditing(false)
                                              setExpanded(true)
                                              setAutoFocusEditor(true)
                                          } else {
                                              setExpanded(false)
                                              setAutoFocusEditor(false)
                                          }
                                      }
                                    : undefined
                            }
                            currentMode={isStringContent ? mode : undefined}
                        >
                            <TypeChip
                                variant={chip}
                                onClick={editable ? () => {} : undefined}
                                notificationBadge={
                                    isStringContent &&
                                    mode === "short" &&
                                    typeof draft === "string" &&
                                    isLongFormString(draft)
                                }
                                badgeTooltip="Long content detected — click to switch to long-form editor"
                            />
                        </ChipConversionPopover>
                    </span>
                ) : (
                    <span style={{width: 0}} />
                )}
                {/* Render-hint chip (axis 2). The [markdown] chip is the
                    entry point for the editor-mode toggle (lives on the
                    render-type chip per JP feedback). Other render hints
                    are informational. */}
                {showChip && renderHint === "markdown" ? (
                    <span onClick={(e) => e.stopPropagation()}>
                        <ChipConversionPopover
                            variant="markdown"
                            value={draft}
                            editable={editable}
                            onConvert={undefined}
                            onModeSwitch={(next) => {
                                setForcedMode(next)
                                if (next === "long") {
                                    setEditing(false)
                                    setExpanded(true)
                                    setAutoFocusEditor(true)
                                } else {
                                    setExpanded(false)
                                    setAutoFocusEditor(false)
                                }
                            }}
                            currentMode={mode}
                        >
                            <TypeChip
                                variant="markdown"
                                onClick={editable ? () => {} : undefined}
                            />
                        </ChipConversionPopover>
                    </span>
                ) : showChip && renderHint ? (
                    <span onClick={(e) => e.stopPropagation()}>
                        <TypeChip variant={renderHint} />
                    </span>
                ) : null}
                <span style={styles.name}>{name}</span>
                <span style={styles.valueSlot} onClick={(e) => editing && e.stopPropagation()}>
                    {/* String + null share one branch: typing into a null
                        field initializes it as a string immediately. The
                        controlled `value` (always coerced to "") plus the
                        `onChange` writing setDraft(e.target.value) means
                        the first keystroke flips draft from `null` → "x"
                        (string). Re-render keeps this same branch (still
                        string-or-null), so the input doesn't unmount and
                        focus is preserved. Without this, the previous
                        null branch was uncontrolled (defaultValue="" + no
                        onChange) — typing showed in the DOM but never
                        reached state, and blur lost the value. */}
                    {editing && (kind === "string" || kind === "null") && mode === "short" ? (
                        <Input
                            size="small"
                            autoFocus
                            variant="borderless"
                            value={typeof draft === "string" ? draft : ""}
                            placeholder={kind === "null" ? "null" : undefined}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => setEditing(false)}
                            onPressEnter={() => setEditing(false)}
                            style={styles.inlineInput}
                        />
                    ) : editing && kind === "number" ? (
                        <InputNumber
                            size="small"
                            autoFocus
                            variant="borderless"
                            value={draft as number}
                            onChange={(n) => setDraft(n)}
                            onBlur={() => setEditing(false)}
                            onPressEnter={() => setEditing(false)}
                            style={styles.inlineInput}
                        />
                    ) : editing && kind === "boolean" ? (
                        <Switch
                            size="small"
                            autoFocus
                            checked={Boolean(draft)}
                            onChange={(b) => {
                                setDraft(b)
                                setEditing(false)
                            }}
                        />
                    ) : (
                        <span
                            style={{
                                ...styles.previewBase,
                                ...(chipMode === "none"
                                    ? previewStyle
                                    : {color: "rgba(5, 23, 41, 0.75)"}),
                            }}
                        >
                            {renderPreview(draft, kind, parsed)}
                        </span>
                    )}
                </span>
                {editable && !editing && isShortPrimitive ? (
                    <PencilSimple size={11} style={styles.editHint} />
                ) : (
                    <span style={{width: 11}} />
                )}
            </div>
            {expanded && isStringContent && mode === "long" && (
                <div style={styles.expansion}>
                    {/* Long-form / markdown body — production Lexical editor
                        (SharedEditor) + visible MarkdownToggleButton sharing
                        the same editorId so non-technical users see a clear
                        Preview / Edit-raw switch instead of guessing. Stays
                        mounted as long as the row's mode is "long", regardless
                        of how short the current draft is — switching modes is
                        explicit (chip popover), so the user is in control of
                        when the editor mounts/unmounts. No focus break. */}
                    <EditorProvider
                        key={`${editorId}-text-provider`}
                        id={editorId}
                        initialValue={String(draft ?? "")}
                        showToolbar={false}
                        enableTokens={false}
                    >
                        <div style={styles.longFormWrap}>
                            <div style={styles.longFormToolbar}>
                                <span style={styles.longFormHint}>Markdown</span>
                                <MarkdownToggleButton id={editorId} />
                            </div>
                            <SharedEditor
                                id={editorId}
                                initialValue={String(draft ?? "")}
                                editorType="border"
                                className="overflow-visible"
                                disableDebounce
                                noProvider
                                disabled={!editable}
                                state={editable ? undefined : "readOnly"}
                                handleChange={
                                    editable ? (next: string) => setDraft(next) : undefined
                                }
                                autoFocus={autoFocusEditor}
                            />
                        </div>
                    </EditorProvider>
                </div>
            )}
            {expanded && !isShortPrimitive && !(isStringContent && mode === "long") && (
                <div style={styles.expansion}>
                    <ProposedDrillIn
                        data={
                            kind === "object"
                                ? (value as Record<string, unknown>)
                                : kind === "stringified"
                                  ? {[name]: parsed}
                                  : {[name]: value}
                        }
                        rootTitle={name}
                        chipMode={chipMode}
                        editable={editable}
                        autoExpand
                    />
                </div>
            )}
        </div>
    )
}

export function PlaygroundExecutionItemCompact({
    testcaseLabel,
    inputs,
    unusedTestcaseColumns,
    output,
    evaluators,
    durationMs = 1240,
    chipMode = "all",
    editable = true,
}: PlaygroundExecutionItemCompactProps) {
    const outputClass = useMemo(() => classifyKind(output), [output])
    const outputIsScalar =
        outputClass.kind === "string" ||
        outputClass.kind === "number" ||
        outputClass.kind === "boolean" ||
        outputClass.kind === "null"
    const outputIsString = outputClass.kind === "string"
    // Output viewer mode — short (plain text) vs long (Lexical SharedEditor
    // read-only with markdown preview). Hydration heuristic identical to the
    // input rows: if the output is already long-form, default to "long" so
    // the user opens to a rendered markdown view. After mount, only the
    // chip popover changes mode (no auto-switching during anything).
    const [outputMode, setOutputMode] = useState<"short" | "long">(() =>
        typeof output === "string" && isLongFormString(output) ? "long" : "short",
    )
    const outputChip: ChipVariant = outputClass.chip
    const outputRenderHint: ChipVariant | null =
        outputIsString && outputMode === "long" ? "markdown" : outputClass.hint
    const outputEditorId = useId()

    return (
        <div style={styles.card}>
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    <span style={styles.testcaseName}>{testcaseLabel}</span>
                    <span style={styles.statusPill}>completed</span>
                    <span style={styles.duration}>{durationMs}ms</span>
                </div>
                <button type="button" style={styles.runButton} disabled={!editable}>
                    <ArrowClockwise size={12} />
                    <span>Run</span>
                </button>
            </header>

            <section style={styles.inputsSection}>
                <div style={styles.sectionLabel}>Inputs</div>
                <div style={styles.rowList}>
                    {inputs.map((f) => (
                        <CompactRow
                            key={f.name}
                            name={f.name}
                            value={f.value}
                            chipMode={chipMode}
                            editable={editable}
                        />
                    ))}
                </div>
                {unusedTestcaseColumns && unusedTestcaseColumns.length > 0 ? (
                    <UnusedColumnsFooterCompact columns={unusedTestcaseColumns} />
                ) : null}
            </section>

            <section style={styles.section}>
                <div style={styles.outputHeader}>
                    <div style={styles.sectionLabel}>Output</div>
                    {chipMode !== "none" ? (
                        <ChipConversionPopover
                            variant={outputChip}
                            value={output}
                            editable={true}
                            // Output is read-only — no type conversions. The
                            // viewer-mode toggle lives on the render-hint
                            // chip when one is visible (per JP feedback);
                            // type chip is fallback when no render hint.
                            onConvert={undefined}
                            onModeSwitch={
                                outputIsString && outputRenderHint !== "markdown"
                                    ? (next) => setOutputMode(next)
                                    : undefined
                            }
                            currentMode={outputIsString ? outputMode : undefined}
                        >
                            <TypeChip variant={outputChip} onClick={() => {}} />
                        </ChipConversionPopover>
                    ) : null}
                    {chipMode !== "none" && outputRenderHint === "markdown" ? (
                        <ChipConversionPopover
                            variant="markdown"
                            value={output}
                            editable={true}
                            onConvert={undefined}
                            onModeSwitch={(next) => setOutputMode(next)}
                            currentMode={outputMode}
                        >
                            <TypeChip variant="markdown" onClick={() => {}} />
                        </ChipConversionPopover>
                    ) : chipMode !== "none" && outputRenderHint ? (
                        <TypeChip variant={outputRenderHint} />
                    ) : null}
                </div>
                <div style={styles.outputBody}>
                    {outputIsString && outputMode === "long" ? (
                        // Long-form / markdown view of the output — read-only
                        // SharedEditor lets the user toggle between rendered
                        // markdown and raw source via the existing button.
                        <EditorProvider
                            key={`${outputEditorId}-text-provider`}
                            id={outputEditorId}
                            initialValue={String(output)}
                            showToolbar={false}
                            enableTokens={false}
                        >
                            <div style={styles.longFormWrap}>
                                <div style={styles.longFormToolbar}>
                                    <span style={styles.longFormHint}>Markdown</span>
                                    <MarkdownToggleButton id={outputEditorId} />
                                </div>
                                <SharedEditor
                                    id={outputEditorId}
                                    initialValue={String(output)}
                                    editorType="border"
                                    className="overflow-visible"
                                    disableDebounce
                                    noProvider
                                    disabled
                                    state="readOnly"
                                />
                            </div>
                        </EditorProvider>
                    ) : outputIsScalar ? (
                        <span style={styles.outputText}>{String(output)}</span>
                    ) : (
                        <ProposedDrillIn
                            data={
                                outputClass.kind === "object"
                                    ? (output as Record<string, unknown>)
                                    : {result: output}
                            }
                            rootTitle="response"
                            chipMode={chipMode}
                            editable={false}
                            autoExpand
                        />
                    )}
                </div>
            </section>

            {evaluators && evaluators.length > 0 ? (
                <section style={styles.evalStrip}>
                    <span style={styles.sectionLabel}>Evaluators</span>
                    {evaluators.map((e) => (
                        <span
                            key={e.name}
                            style={{
                                ...styles.evalChip,
                                background: e.passed ? "#f6ffed" : "#fff2f0",
                                color: e.passed ? "#389e0d" : "#cf1322",
                                borderColor: e.passed
                                    ? "rgba(56, 158, 13, 0.3)"
                                    : "rgba(207, 19, 34, 0.3)",
                            }}
                        >
                            {e.name}: {e.score.toFixed(2)}
                        </span>
                    ))}
                </section>
            ) : null}
        </div>
    )
}

/**
 * Peekable footer below the Compact inputs body listing testcase columns
 * the prompt chain doesn't reference. Default closed; click to reveal.
 * See PlaygroundExecutionItem's `UnusedColumnsFooter` for the rationale.
 */
function UnusedColumnsFooterCompact({columns}: {columns: string[]}) {
    const [open, setOpen] = useState(false)
    return (
        <div style={styles.unusedFooter}>
            <button type="button" style={styles.unusedToggle} onClick={() => setOpen((v) => !v)}>
                <span style={styles.unusedCaret}>{open ? "▾" : "▸"}</span>
                <span>
                    {open ? "Hide" : "Show"} {columns.length} unused testcase column
                    {columns.length === 1 ? "" : "s"}
                </span>
            </button>
            {open ? (
                <ul style={styles.unusedList}>
                    {columns.map((c) => (
                        <li key={c} style={styles.unusedItem}>
                            <code style={styles.unusedItemName}>{c}</code>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    )
}

const styles = {
    card: {
        background: "white",
        border: "1px solid rgba(5, 23, 41, 0.08)",
        borderRadius: 8,
        overflow: "hidden" as const,
        display: "flex",
        flexDirection: "column" as const,
        boxShadow: "0 2px 8px rgba(5, 23, 41, 0.04)",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "10px 14px",
        background: "#fafafa",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
        gap: 8,
    },
    headerLeft: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
    },
    testcaseName: {
        fontSize: 13,
        fontWeight: 600,
        color: "#051729",
    },
    statusPill: {
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#f6ffed",
        color: "#389e0d",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    duration: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    runButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontWeight: 600,
        padding: "4px 10px",
        borderRadius: 4,
        background: "#1677ff",
        color: "white",
        border: "none",
        cursor: "pointer",
    },
    section: {
        padding: "10px 14px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
    },
    inputsSection: {
        padding: "8px 8px 10px",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
    },
    sectionLabel: {
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        display: "block",
        padding: "0 6px",
        marginBottom: 4,
    },
    rowList: {
        display: "flex",
        flexDirection: "column" as const,
    },
    rowOuter: {
        borderBottom: "1px solid rgba(5, 23, 41, 0.04)",
    },
    row: {
        display: "grid",
        gridTemplateColumns: "16px auto auto 1fr 14px",
        alignItems: "center",
        gap: 8,
        minHeight: 26,
        padding: "2px 8px",
        borderRadius: 4,
    },
    caret: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center" as const,
        color: "rgba(5, 23, 41, 0.45)",
        width: 14,
    },
    name: {
        fontSize: 12,
        fontWeight: 500,
        color: "#051729",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        whiteSpace: "nowrap" as const,
    },
    valueSlot: {
        minWidth: 0,
        display: "flex",
        alignItems: "center",
    },
    previewBase: {
        fontSize: 12,
        overflow: "hidden" as const,
        textOverflow: "ellipsis" as const,
        whiteSpace: "nowrap" as const,
    },
    preview: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        color: "rgba(5, 23, 41, 0.75)",
    },
    inlineInput: {
        fontSize: 12,
        padding: 0,
        height: 22,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    editHint: {
        color: "rgba(5, 23, 41, 0.25)",
        justifySelf: "end" as const,
    },
    expansion: {
        padding: "6px 8px 8px 36px",
        background: "rgba(5, 23, 41, 0.02)",
    },
    outputHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
    },
    outputBody: {
        background: "#fafafa",
        border: "1px solid rgba(5, 23, 41, 0.06)",
        borderRadius: 6,
        padding: 10,
    },
    outputText: {
        fontSize: 12,
        color: "#051729",
        lineHeight: 1.5,
    },
    evalStrip: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        background: "#fafafa",
        flexWrap: "wrap" as const,
    },
    evalChip: {
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        padding: "2px 8px",
        borderRadius: 4,
        border: "1px solid",
        fontWeight: 600,
    },
    longFormWrap: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 4,
        border: "1px solid rgba(5, 23, 41, 0.12)",
        borderRadius: 6,
        background: "white",
        overflow: "hidden" as const,
    },
    longFormToolbar: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between" as const,
        padding: "4px 8px",
        background: "#fafafa",
        borderBottom: "1px solid rgba(5, 23, 41, 0.06)",
    },
    longFormHint: {
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(5, 23, 41, 0.55)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
    },
    unusedFooter: {
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px dashed rgba(5, 23, 41, 0.08)",
    },
    unusedToggle: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: "2px 0",
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.65)",
        textAlign: "left" as const,
    },
    unusedCaret: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.45)",
    },
    unusedList: {
        listStyle: "none" as const,
        margin: "6px 0 0",
        padding: 0,
        display: "flex",
        flexWrap: "wrap" as const,
        gap: 6,
    },
    unusedItem: {
        opacity: 0.65,
    },
    unusedItemName: {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        background: "rgba(5, 23, 41, 0.04)",
        padding: "1px 6px",
        borderRadius: 3,
        color: "rgba(5, 23, 41, 0.65)",
    },
}

export default PlaygroundExecutionItemCompact
