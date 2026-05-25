/**
 * FormView — recursive form rendering of an object value.
 *
 * Layout (per the design-mockups POC reference):
 *   - Vertical stack of form fields. Each field has a bold label on top and
 *     a body below. Fields separated by ~20px of vertical space.
 *   - Children of a nested object are indented behind a 2px light-gray
 *     vertical rail.
 *   - String leaf: a small card (1px gray border, 8px radius, white bg).
 *     A compact `View as ▾` dropdown sits in the field's label row, on the
 *     right. Below the card sits a `SharedEditor` with line numbers.
 *   - Number leaf: a single-line `InputNumber` with placeholder text.
 *   - Boolean leaf: a `Switch`.
 *   - Null leaf: italic muted "null".
 *   - Object / array: bold label, then a 2px gray left rail with the
 *     children stacked inside, indented ~16-20px. Children recurse.
 *
 * Color palette is intentionally minimal: white background, light-gray
 * borders (#e5e7eb), dark labels, gray placeholders. No accent colors
 * inside the form. Top-level kind chips live in the section header above.
 *
 * Promoted from the design-mockups POC (`ProposalV2FormView.tsx`).
 */

import {useCallback, useMemo, useState, type ReactNode} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import {Input, InputNumber, Switch, Tag} from "antd"
import {dump as yamlDump, load as yamlLoad} from "js-yaml"

import {
    detectNestedKind,
    getDefaultViewForValue,
    getViewOptions,
    type NestedKind,
    type ViewType,
} from "./viewTypes"
import {ViewTypeSelect} from "./ViewTypeSelect"

const NESTED_KIND_LABEL: Record<NestedKind, string> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    null: "null",
    object: "object",
    array: "array",
}

const NESTED_KIND_TONE: Record<NestedKind, string> = {
    string: "geekblue",
    number: "blue",
    boolean: "purple",
    null: "default",
    object: "gold",
    array: "magenta",
}

interface FormViewProps {
    value: Record<string, unknown>
    onChange: (next: unknown) => void
    editable?: boolean
}

export function FormView({value, onChange, editable}: FormViewProps) {
    // Wrap the entire form in a rail so the children visually read as
    // "contents of the variable named in the section header above" — the
    // rail is consistent with the rail that appears at deeper levels.
    return (
        <div style={styles.formOuter}>
            <ObjectRows
                obj={value}
                onChange={(next) => onChange(next)}
                depth={0}
                editable={!!editable}
            />
        </div>
    )
}

/* ── Recursive object rows ──────────────────────────────────────────── */

interface ObjectRowsProps {
    obj: Record<string, unknown>
    depth: number
    editable: boolean
    onChange: (next: Record<string, unknown>) => void
}

function ObjectRows({obj, depth, editable, onChange}: ObjectRowsProps) {
    const entries = Object.entries(obj)
    if (entries.length === 0) {
        return <span style={styles.emptyHint}>(empty object)</span>
    }
    const updateKey = (key: string, next: unknown) => {
        onChange({...obj, [key]: next})
    }
    return (
        <div style={depth === 0 ? styles.rootStack : styles.nestedStack}>
            {entries.map(([key, child]) => (
                <FormField
                    key={key}
                    label={key}
                    value={child}
                    depth={depth}
                    editable={editable}
                    onChange={(next) => updateKey(key, next)}
                />
            ))}
        </div>
    )
}

/* ── Single form field (label + body) ──────────────────────────────── */

interface FormFieldProps {
    label: string
    value: unknown
    depth: number
    editable: boolean
    onChange: (next: unknown) => void
}

function FormField({label, value, depth, editable, onChange}: FormFieldProps) {
    const kind = detectNestedKind(value)
    const labelStyle = depth === 0 ? styles.labelTop : styles.labelNested

    // For string fields we manage a per-field view mode (Text / Markdown /
    // JSON / YAML). The view-type selector lives in the label row, on the
    // right — same component the section header uses for the top-level
    // variable, so the pattern is consistent across the surface.
    const isString = kind === "string"
    const stringOptions = useMemo(() => (isString ? getViewOptions(value) : []), [isString, value])
    const [stringMode, setStringMode] = useState<ViewType>(() =>
        isString ? getDefaultViewForValue(value) : "text",
    )

    return (
        <div style={styles.field}>
            <div style={styles.labelRow}>
                <div style={styles.labelLeft}>
                    <label style={labelStyle}>{label}</label>
                    <Tag color={NESTED_KIND_TONE[kind]} style={styles.kindTag} variant="filled">
                        {NESTED_KIND_LABEL[kind]}
                    </Tag>
                </div>
                {isString ? (
                    <ViewTypeSelect
                        value={stringMode}
                        options={stringOptions}
                        onChange={setStringMode}
                        disabled={!editable}
                    />
                ) : null}
            </div>
            <div style={styles.fieldBody}>
                <FieldBody
                    kind={kind}
                    value={value}
                    depth={depth}
                    editable={editable}
                    onChange={onChange}
                    stringMode={stringMode}
                />
            </div>
        </div>
    )
}

interface FieldBodyProps {
    kind: NestedKind
    value: unknown
    depth: number
    editable: boolean
    onChange: (next: unknown) => void
    /** For strings only — the active view mode chosen via the labelRow dropdown. */
    stringMode?: ViewType
}

function FieldBody({
    kind,
    value,
    depth,
    editable,
    onChange,
    stringMode,
}: FieldBodyProps): ReactNode {
    if (kind === "object") {
        return (
            <NestedRail>
                <ObjectRows
                    obj={value as Record<string, unknown>}
                    depth={depth + 1}
                    editable={editable}
                    onChange={(next) => onChange(next)}
                />
            </NestedRail>
        )
    }
    if (kind === "array") {
        const arr = value as unknown[]
        const updateIndex = (idx: number, next: unknown) => {
            const copy = [...arr]
            copy[idx] = next
            onChange(copy)
        }
        return (
            <NestedRail>
                <div style={styles.arrayStack}>
                    {arr.map((item, idx) => (
                        <FormField
                            key={idx}
                            label={String(idx)}
                            value={item}
                            depth={depth + 1}
                            editable={editable}
                            onChange={(next) => updateIndex(idx, next)}
                        />
                    ))}
                </div>
            </NestedRail>
        )
    }
    if (kind === "string") {
        return (
            <StringLeafEditor
                value={value as string}
                mode={stringMode ?? "text"}
                editable={editable}
                onChange={onChange}
            />
        )
    }
    if (kind === "number") {
        return (
            <InputNumber
                size="middle"
                value={value as number}
                disabled={!editable}
                onChange={(next) => onChange(next ?? 0)}
                placeholder="Enter number value"
                style={styles.numberInput}
            />
        )
    }
    if (kind === "boolean") {
        return (
            <Switch
                checked={value as boolean}
                disabled={!editable}
                onChange={(next) => onChange(next)}
            />
        )
    }
    if (kind === "null") {
        return (
            <Input
                size="middle"
                value=""
                placeholder="null"
                disabled={!editable}
                onChange={(e) => onChange(e.target.value)}
                style={styles.input}
            />
        )
    }
    return null
}

/* ── Nested rail (indent + 2px left border) ─────────────────────────── */

function NestedRail({children}: {children: ReactNode}) {
    return <div style={styles.nestedRail}>{children}</div>
}

/* ── String leaf editor (no internal toolbar) ────────────────────────────
   The view-mode dropdown that used to live in this leaf's toolbar moved
   to the field's labelRow (right side), to match the pattern the section
   header uses for the top-level variable. The leaf now renders only the
   editor inside a card. */

interface StringLeafEditorProps {
    value: string
    mode: ViewType
    editable: boolean
    onChange: (next: unknown) => void
}

function StringLeafEditor({value, mode, editable, onChange}: StringLeafEditorProps) {
    // For text/markdown we show the raw string; for json/yaml we try to
    // parse the string as JSON and re-stringify into the target language,
    // falling back to the raw string when the value isn't valid JSON.
    const buffer = useMemo(() => {
        if (mode === "text" || mode === "markdown") return value ?? ""
        try {
            const parsed = JSON.parse(value)
            return mode === "json"
                ? JSON.stringify(parsed, null, 2)
                : yamlDump(parsed, {noCompatMode: true, lineWidth: 100})
        } catch {
            return value ?? ""
        }
    }, [value, mode])

    const handleChange = useCallback(
        (next: string) => {
            if (mode === "json") {
                try {
                    const parsed = JSON.parse(next)
                    // The leaf is a string slot in the parent — serialize
                    // structured edits back into a JSON string.
                    onChange(JSON.stringify(parsed))
                } catch {
                    // ignore invalid JSON
                }
                return
            }
            if (mode === "yaml") {
                try {
                    const parsed = yamlLoad(next)
                    onChange(JSON.stringify(parsed))
                } catch {
                    // ignore invalid YAML
                }
                return
            }
            onChange(next)
        },
        [mode, onChange],
    )

    const isCode = mode === "json" || mode === "yaml"

    return (
        <div style={styles.leafCard}>
            <SharedEditor
                key={`leaf-${mode}-${buffer.length}`}
                initialValue={buffer}
                handleChange={editable ? handleChange : undefined}
                editorType="borderless"
                className="overflow-hidden"
                disableDebounce
                disabled={!editable}
                state={editable ? undefined : "readOnly"}
                placeholder="Enter value"
                editorProps={{
                    codeOnly: isCode,
                    language: isCode ? mode : undefined,
                    showLineNumbers: true,
                    showToolbar: false,
                    disableLongText: !isCode,
                }}
            />
        </div>
    )
}

/* ── Styles ─────────────────────────────────────────────────────────── */

const BORDER = "1px solid #e5e7eb"
const RAIL = "2px solid #e5e7eb"

const styles = {
    formOuter: {
        // Always-on rail at the form root. The rail starts at the same
        // left edge as the section header label (20px in from the section
        // body), and the children sit indented behind it. Visually this
        // says "everything below belongs to the variable named in the
        // header above."
        marginLeft: 20,
        paddingLeft: 16,
        paddingRight: 20,
        borderLeft: RAIL,
    },
    rootStack: {
        display: "flex",
        flexDirection: "column" as const,
        // ~24px between top-level fields.
        gap: 24,
    },
    nestedStack: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 18,
    },
    arrayStack: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 18,
    },
    field: {
        display: "flex",
        flexDirection: "column" as const,
        // Generous space between the label/kind chip row and the field body.
        gap: 10,
    },
    fieldBody: {
        display: "block",
    },
    labelRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        minWidth: 0,
    },
    labelLeft: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        minWidth: 0,
    },
    kindTag: {
        fontSize: 10,
        marginInlineEnd: 0,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    labelTop: {
        fontSize: 14,
        fontWeight: 600,
        color: "#1f2937",
    },
    labelNested: {
        fontSize: 13,
        fontWeight: 600,
        color: "#1f2937",
    },
    nestedRail: {
        marginLeft: 4,
        paddingLeft: 16,
        borderLeft: RAIL,
    },
    /* String leaf card — no toolbar; the dropdown lives in the field's
       label row, matching the section header's pattern. */
    leafCard: {
        background: "white",
        border: BORDER,
        borderRadius: 8,
        overflow: "hidden",
        padding: "6px 4px",
    },
    /* Primitive inputs */
    input: {
        fontSize: 13,
        maxWidth: 480,
    },
    numberInput: {
        fontSize: 13,
        width: 240,
    },
    emptyHint: {
        fontSize: 12,
        color: "#9ca3af",
        fontStyle: "italic" as const,
    },
}

export default FormView
