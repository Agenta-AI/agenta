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
 * Color palette is intentionally minimal: container background, border-
 * secondary borders, primary text labels, tertiary text placeholders.
 * All colours route through `--ag-color*` theme tokens so light is
 * byte-identical and dark mode inverts via `.dark`. No accent colors
 * inside the form. Top-level kind chips live in the section header above.
 *
 * Promoted from the design-mockups POC (`ProposalV2FormView.tsx`).
 */

import {useCallback, useMemo, useState, type ReactNode} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import type {ChipVariant} from "@agenta/ui/type-chip"
import {MinusCircle, Plus} from "@phosphor-icons/react"
import {Button as AntdButton, Input, InputNumber, Switch} from "antd"
import {dump as yamlDump, load as yamlLoad} from "js-yaml"

import {
    buildEmptyShapeFromSchema,
    detectNestedKind,
    getDefaultViewForValue,
    getViewOptions,
    type NestedKind,
    type ViewType,
} from "./viewTypes"
import {ViewTypeSelect} from "./ViewTypeSelect"

// Map the 6-way nested kind to the shared TypeChip vocabulary so nested
// field labels use the SAME chip the parent VariableCard renders — keeps
// the visual hierarchy consistent (parent name + chip → child name + chip
// with the same look).
const NESTED_KIND_CHIP: Record<NestedKind, ChipVariant> = {
    string: "string",
    number: "number",
    boolean: "boolean",
    null: "null",
    object: "json-object",
    array: "json-array",
}

interface FormViewProps {
    value: Record<string, unknown> | unknown[]
    onChange: (next: unknown) => void
    editable?: boolean
    /**
     * Optional JSON Schema fragment describing the value's expected shape.
     * Threaded through every nested field so:
     *   - Each array node derives its OWN `+ Add row` template from its
     *     `items` schema, not a single global template.
     *   - Nested array-of-objects inside an outer array (e.g.
     *     `repos[i].contributors`) gets a template matching the inner
     *     items shape (`{name: ""}`), not the outer row shape.
     *
     * Without the schema, arrays still render but new rows default to
     * `null` (no template). Most callers pass the port schema directly;
     * see `PlaygroundInputsBody/VariableCard.tsx` for the canonical
     * wiring.
     */
    schema?: unknown
}

export function FormView({value, onChange, editable, schema}: FormViewProps) {
    // Wrap the entire form in a rail so the children visually read as
    // "contents of the variable named in the section header above" — the
    // rail is consistent with the rail that appears at deeper levels.
    return (
        <div style={styles.formOuter}>
            {Array.isArray(value) ? (
                <ArrayBody
                    arr={value}
                    depth={0}
                    editable={!!editable}
                    schema={schema}
                    onChange={(next) => onChange(next)}
                />
            ) : (
                <ObjectRows
                    obj={value}
                    onChange={(next) => onChange(next)}
                    depth={0}
                    editable={!!editable}
                    schema={schema}
                />
            )}
        </div>
    )
}

/* ── Recursive object rows ──────────────────────────────────────────── */

interface ObjectRowsProps {
    obj: Record<string, unknown>
    depth: number
    editable: boolean
    onChange: (next: Record<string, unknown>) => void
    schema?: unknown
}

function ObjectRows({obj, depth, editable, onChange, schema}: ObjectRowsProps) {
    const properties = (schema as {properties?: Record<string, unknown>} | null)?.properties

    // Iterate the SCHEMA's keys as the canonical source of truth when
    // available, then append any value-only keys (preserves legacy data /
    // user additions outside the declared schema). This is what lets a
    // newly-added field on the prompt template (e.g. typing a new
    // `{{#test}}{{xyz}}{{/test}}` section inside `{{#repos}}`) appear on
    // EXISTING rows that were filled before the schema gained the field
    // — otherwise the row stayed at its old shape and the user couldn't
    // see / fill the new sub-path.
    const schemaKeys = properties ? Object.keys(properties) : []
    const valueKeys = Object.keys(obj)
    const extraKeys = valueKeys.filter((k) => !(properties && k in properties))
    const keys: string[] = properties ? [...schemaKeys, ...extraKeys] : valueKeys

    if (keys.length === 0) {
        return <span style={styles.emptyHint}>(empty object)</span>
    }

    const updateKey = (key: string, next: unknown) => {
        onChange({...obj, [key]: next})
    }

    return (
        <div style={depth === 0 ? styles.rootStack : styles.nestedStack}>
            {keys.map((key) => {
                // Value-present keys use the value; schema-only keys
                // (existing-row gap) get an empty default derived from
                // their declared schema, so the user can fill them in
                // immediately without manually adding the field first.
                const childValue =
                    key in obj
                        ? obj[key]
                        : ((properties && buildEmptyShapeFromSchema(properties[key])) ?? "")
                return (
                    <FormField
                        key={key}
                        label={key}
                        value={childValue}
                        depth={depth}
                        editable={editable}
                        onChange={(next) => updateKey(key, next)}
                        schema={properties?.[key]}
                    />
                )
            })}
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
    schema?: unknown
    /**
     * Optional content rendered at the FAR RIGHT of the label row, after
     * the view-type selector. Used by `ArrayBody` to place a row's remove
     * button inline with the label — so the field body (and any nested
     * view-type selectors) extends to the same right edge as non-array
     * fields, instead of being inset by the button width.
     */
    headerRight?: ReactNode
}

function FormField({label, value, depth, editable, onChange, schema, headerRight}: FormFieldProps) {
    const kind = detectNestedKind(value)

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
                    {/* Label style matches the parent `VariableCard`'s name:
                     *  mono, 12px, weight 500, blue. The depth / nesting is
                     *  communicated by the indentation + rail above — no need
                     *  to shout with a heavier label.
                     *
                     *  Children must NOT visually outweigh their parent — the
                     *  parent's name + chip set the bar, the nested fields
                     *  use the same vocabulary. */}
                    <label style={styles.fieldLabel}>{label}</label>
                    <TypeChip variant={NESTED_KIND_CHIP[kind]} value={value} />
                </div>
                <div style={styles.labelRight}>
                    {isString ? (
                        <ViewTypeSelect
                            value={stringMode}
                            options={stringOptions}
                            onChange={setStringMode}
                            disabled={!editable}
                        />
                    ) : null}
                    {headerRight}
                </div>
            </div>
            <div style={styles.fieldBody}>
                <FieldBody
                    kind={kind}
                    value={value}
                    depth={depth}
                    editable={editable}
                    onChange={onChange}
                    stringMode={stringMode}
                    schema={schema}
                />
            </div>
        </div>
    )
}

/* ── Array body (rows + add/remove row affordances) ─────────────────── */

interface ArrayBodyProps {
    arr: unknown[]
    depth: number
    editable: boolean
    onChange: (next: unknown[]) => void
    /**
     * Schema fragment for the ARRAY itself (`{type: "array", items: {…}}`).
     * The row template for `+ Add row` is derived from `schema.items`
     * locally — this ensures nested arrays inside an array-of-objects
     * (e.g. `repos[i].contributors`) use the INNER items shape, not the
     * outer row shape. Without a schema, new rows default to `null`.
     */
    schema?: unknown
}

function cloneTemplate(template: unknown): unknown {
    if (template === undefined || template === null) return null
    if (typeof template !== "object") return template
    // `structuredClone` was added to all major browsers / Node 17+. The
    // FE targets Node 22 and modern browsers per the toolchain, so this
    // is safe — and it handles nested arrays/objects/dates correctly.
    return structuredClone(template)
}

/**
 * Renders an array as a stack of row editors with `+ Add row` (when
 * editable) and a per-row remove button. Each row is the same
 * `FormField` used for object properties — so an array of strings
 * shows a string input per row, and an array of objects shows a
 * nested form per row.
 *
 * Used at both the FormView ROOT (when the variable's value is itself
 * an array — e.g. `repos` typed as array-of-objects from a mustache
 * section opener) and at NESTED depths (when an object property is
 * an array). The behaviour is identical at both levels; the only
 * difference is whether the parent supplies a label.
 *
 * Phase 2d of `docs/designs/mustache-section-support.md` — the
 * "form-array editor" piece.
 */
function ArrayBody({arr, depth, editable, onChange, schema}: ArrayBodyProps) {
    // Derive the row template + per-row schema FROM THIS array's local
    // items schema — not from a global template passed down. This is
    // what makes nested array-of-objects (e.g. `repos[i].contributors`)
    // get the inner item shape (`{name: ""}`) instead of the outer row
    // shape (`{name, stars, description, contributors}`).
    const itemsSchema = (schema as {items?: unknown} | null)?.items
    const rowTemplate = itemsSchema ? buildEmptyShapeFromSchema(itemsSchema) : undefined

    const updateIndex = (idx: number, next: unknown) => {
        const copy = [...arr]
        copy[idx] = next
        onChange(copy)
    }
    const removeIndex = (idx: number) => {
        onChange(arr.filter((_, i) => i !== idx))
    }
    const addRow = () => {
        onChange([...arr, cloneTemplate(rowTemplate)])
    }

    return (
        <div style={styles.arrayStack}>
            {arr.length === 0 && !editable ? (
                <span style={styles.emptyHint}>(empty array)</span>
            ) : null}
            {arr.map((item, idx) => (
                <FormField
                    key={idx}
                    label={String(idx)}
                    value={item}
                    depth={depth}
                    editable={editable}
                    onChange={(next) => updateIndex(idx, next)}
                    // Each row's schema is the array's items schema —
                    // descend into it for nested fields.
                    schema={itemsSchema}
                    // Remove button rides in the label row (far right) so
                    // the field body extends to the full card width and
                    // nested view-type selectors align with the card edge
                    // — not inset by the button. Arda QA 2026-06-02.
                    headerRight={
                        editable ? (
                            <AntdButton
                                type="text"
                                size="small"
                                icon={<MinusCircle size={14} />}
                                aria-label={`Remove row ${idx}`}
                                onClick={() => removeIndex(idx)}
                                style={styles.arrayRowRemove}
                            />
                        ) : undefined
                    }
                />
            ))}
            {editable ? (
                <AntdButton
                    type="dashed"
                    size="small"
                    icon={<Plus size={14} />}
                    onClick={addRow}
                    style={styles.arrayAddRow}
                >
                    Add row
                </AntdButton>
            ) : null}
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
    schema?: unknown
}

function FieldBody({
    kind,
    value,
    depth,
    editable,
    onChange,
    stringMode,
    schema,
}: FieldBodyProps): ReactNode {
    if (kind === "object") {
        return (
            <NestedRail>
                <ObjectRows
                    obj={value as Record<string, unknown>}
                    depth={depth + 1}
                    editable={editable}
                    onChange={(next) => onChange(next)}
                    schema={schema}
                />
            </NestedRail>
        )
    }
    if (kind === "array") {
        return (
            <NestedRail>
                <ArrayBody
                    arr={value as unknown[]}
                    depth={depth + 1}
                    editable={editable}
                    schema={schema}
                    onChange={onChange}
                />
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
        <SharedEditor
            // Key by `mode` ONLY — switching between text/markdown/json/
            // yaml legitimately needs a remount because `editorProps`
            // (codeOnly, language, disableLongText) change.
            //
            // Do NOT include `buffer.length` or any keystroke-derived
            // signal here. The previous key included `buffer.length`
            // and that re-mounted the editor on every keystroke — which
            // tore down the underlying <textarea>/<contenteditable>
            // element, ripped focus out, and limited the user to
            // one character per typing burst (JP, QA on mustache,
            // 2026-05-28). The editor's own internal state tracks
            // keystrokes; we only need to remount for mode changes.
            key={`leaf-${mode}`}
            initialValue={buffer}
            handleChange={editable ? handleChange : undefined}
            // `border` so the editor itself supplies its border, hover and
            // focus states — matches the config-message editor's look and
            // gives the input a visible boundary in dark mode. Previously
            // wrapped in a `leafCard` div with a static border + no hover
            // state, which read fine in light but didn't surface focus /
            // hover affordances and routed the caret through a layer that
            // ignored theme colors (Kaosiso QA 2026-06-02).
            editorType="border"
            className="overflow-hidden"
            disableDebounce
            disabled={!editable}
            state={editable ? undefined : "readOnly"}
            placeholder="Enter a value"
            editorProps={{
                codeOnly: isCode,
                language: isCode ? mode : undefined,
                showLineNumbers: true,
                showToolbar: false,
                disableLongText: !isCode,
            }}
        />
    )
}

/* ── Styles ─────────────────────────────────────────────────────────── */

// Route through a theme token so light is byte-identical and dark mode
// inverts via the `.dark` selector. (Previous hex `#e5e7eb` rendered as
// a near-white rail on dark canvas — Kaosiso QA 2026-06-02 follow-up.)
// Leaf editor now uses SharedEditor's `editorType="border"` so its own
// border + hover + focus states apply; no leaf-level border needed here.
const RAIL = "2px solid var(--ag-colorBorderSecondary)"

const styles = {
    formOuter: {
        // Always-on rail at the form root. The rail starts at the same
        // left edge as the section header label (20px in from the section
        // body), and the children sit indented behind it. Visually this
        // says "everything below belongs to the variable named in the
        // header above."
        //
        // No right padding — labels, leaf cards, and View-as buttons all
        // extend to the card content's right edge so they share one
        // vertical alignment with the card-level header above. Adding a
        // padding-right here would push everything inside out of sync
        // with the card-level dropdown.
        marginLeft: 20,
        paddingLeft: 16,
        paddingRight: 0,
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
    arrayRowRemove: {
        // Lives in the row's label row (far right, via FormField's
        // `headerRight` slot) so the field body extends to the full card
        // width and nested view-type selectors align with the card edge.
        color: "var(--ag-colorTextTertiary)",
    },
    arrayAddRow: {
        // Dashed primary-color affordance; visually distinct from the
        // filled rows so the user reads it as an action rather than a
        // row of data. Aligned to the left so the rows visually anchor
        // at the same leading edge.
        alignSelf: "flex-start",
        marginTop: 4,
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
    labelRight: {
        // Holds the view-type selector and/or a row remove button. Sits
        // hard against the label row's right edge (the parent labelRow is
        // `justify-content: space-between`), so its contents align with
        // every other field's right edge regardless of array nesting.
        display: "flex",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
    },
    /* Nested field label — distinguishes a PROPERTY of the value from the
     * VARIABLE NAME (which the parent VariableCard renders in blue mono).
     * Dark + bold + sans-serif at the parent name's size, so children
     * don't outweigh the parent but still read as a distinct concept. */
    fieldLabel: {
        fontSize: 12,
        fontWeight: 600,
        lineHeight: "20px",
        color: "var(--ag-colorText)",
        margin: 0,
    },
    nestedRail: {
        marginLeft: 4,
        paddingLeft: 16,
        borderLeft: RAIL,
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
        color: "var(--ag-colorTextTertiary)",
        fontStyle: "italic" as const,
    },
}

export default FormView
