/**
 * SchemaForm — Braintrust-style schema-aware drill-in form (gap-07).
 *
 * Renders a labelled form with type-aware inputs per known column. Required
 * fields flagged. Per-field PATCH on save (no JSON-blob replay). Falls back
 * to the existing detection-driven `ProposedDrillIn` when no schema exists
 * (the parent decides which to mount).
 *
 * Driving idea: a per-testset schema entity becomes the source of truth for
 * what fields should appear, regardless of whether *this row* has them. Same
 * schema also drives playground variable validation (gap-08) — one
 * investment, two payoffs.
 *
 * Static mock for the design exploration. Real implementation would back
 * this with a per-testset column schema and connect each input to a
 * per-field PATCH save.
 */

export interface SchemaField {
    key: string
    type: "string" | "number" | "boolean" | "object" | "array"
    required?: boolean
    description?: string
    nested?: SchemaField[]
}

interface SchemaFormProps {
    schema: SchemaField[]
    data: Record<string, unknown>
    depth?: number
}

export function SchemaForm({schema, data, depth = 0}: SchemaFormProps) {
    return (
        <div style={{...styles.form, marginLeft: depth === 0 ? 0 : 12}}>
            {schema.map((field) => {
                const value = data?.[field.key]
                const present = value !== undefined && value !== null
                return (
                    <div key={field.key} style={styles.field}>
                        <div style={styles.fieldHeader}>
                            <label style={styles.fieldLabel}>
                                {field.key}
                                {field.required ? <span style={styles.required}>*</span> : null}
                            </label>
                            <span style={styles.typeChip}>{field.type}</span>
                            {field.description ? (
                                <span style={styles.fieldHint}>{field.description}</span>
                            ) : null}
                            {!present && !field.required ? (
                                <span style={styles.optionalEmpty}>not set</span>
                            ) : null}
                        </div>
                        <FieldInput field={field} value={value} depth={depth} />
                    </div>
                )
            })}
        </div>
    )
}

interface FieldInputProps {
    field: SchemaField
    value: unknown
    depth: number
}

function FieldInput({field, value, depth}: FieldInputProps) {
    if (field.type === "object" && field.nested) {
        return (
            <div style={styles.nested}>
                <SchemaForm
                    schema={field.nested}
                    data={(value as Record<string, unknown>) ?? {}}
                    depth={depth + 1}
                />
            </div>
        )
    }
    if (field.type === "array") {
        const items = Array.isArray(value) ? value : []
        return (
            <div style={styles.arrayInput}>
                {items.length === 0 ? (
                    <span style={styles.fieldHint}>no items</span>
                ) : (
                    items.map((item, i) => (
                        <input
                            key={i}
                            type="text"
                            defaultValue={String(item)}
                            style={styles.input}
                        />
                    ))
                )}
                <button type="button" style={styles.addButton}>
                    + add item
                </button>
            </div>
        )
    }
    if (field.type === "boolean") {
        return (
            <div style={styles.booleanGroup}>
                <label style={styles.boolOption}>
                    <input type="radio" defaultChecked={value === true} name={field.key} /> true
                </label>
                <label style={styles.boolOption}>
                    <input type="radio" defaultChecked={value === false} name={field.key} /> false
                </label>
                <label style={styles.boolOption}>
                    <input
                        type="radio"
                        defaultChecked={value === null || value === undefined}
                        name={field.key}
                    />{" "}
                    null
                </label>
            </div>
        )
    }
    if (field.type === "number") {
        return (
            <input type="number" defaultValue={value as number | undefined} style={styles.input} />
        )
    }
    return (
        <textarea
            defaultValue={value !== undefined && value !== null ? String(value) : ""}
            style={styles.textarea}
            rows={(value as string)?.length > 80 ? 3 : 1}
        />
    )
}

export function countSchemaFields(schema: SchemaField[]): number {
    return schema.reduce((count, f) => count + 1 + (f.nested ? countSchemaFields(f.nested) : 0), 0)
}

const styles = {
    form: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 12,
        padding: 4,
    },
    field: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 6,
    },
    fieldHeader: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap" as const,
    },
    fieldLabel: {
        fontSize: 12,
        fontWeight: 600,
        color: "#051729",
    },
    required: {
        color: "#cf1322",
        marginLeft: 2,
    },
    typeChip: {
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 3,
        background: "rgba(5, 23, 41, 0.06)",
        color: "rgba(5, 23, 41, 0.65)",
        textTransform: "uppercase" as const,
        letterSpacing: "0.04em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    },
    fieldHint: {
        fontSize: 11,
        color: "rgba(5, 23, 41, 0.55)",
    },
    optionalEmpty: {
        fontSize: 10,
        color: "rgba(5, 23, 41, 0.45)",
        fontStyle: "italic" as const,
    },
    input: {
        fontSize: 12,
        padding: "6px 8px",
        border: "1px solid rgba(5, 23, 41, 0.16)",
        borderRadius: 4,
        fontFamily: "inherit",
        width: "100%",
        boxSizing: "border-box" as const,
    },
    textarea: {
        fontSize: 12,
        padding: "6px 8px",
        border: "1px solid rgba(5, 23, 41, 0.16)",
        borderRadius: 4,
        fontFamily: "inherit",
        width: "100%",
        boxSizing: "border-box" as const,
        resize: "vertical" as const,
    },
    nested: {
        borderLeft: "2px solid rgba(5, 23, 41, 0.08)",
        paddingLeft: 8,
        marginLeft: 4,
    },
    arrayInput: {
        display: "flex",
        flexDirection: "column" as const,
        gap: 4,
    },
    addButton: {
        alignSelf: "flex-start",
        fontSize: 11,
        padding: "2px 8px",
        border: "1px dashed rgba(5, 23, 41, 0.2)",
        borderRadius: 4,
        background: "white",
        color: "rgba(5, 23, 41, 0.65)",
        cursor: "pointer",
    },
    booleanGroup: {
        display: "flex",
        gap: 12,
        fontSize: 12,
    },
    boolOption: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        cursor: "pointer",
    },
}

// Default schema for the fixture02 Tuvalu testcase — moved here so both the
// concept page and the solution page reference the same source.
export const FIXTURE02_INFERRED_SCHEMA: SchemaField[] = [
    {key: "country", type: "string", required: true, description: "ISO country name"},
    {
        key: "inputs",
        type: "object",
        required: true,
        nested: [
            {key: "country", type: "string", required: true},
            {key: "region", type: "string", required: true},
            {key: "population_thousands", type: "number"},
            {key: "is_island_nation", type: "boolean"},
        ],
    },
    {
        key: "outputs",
        type: "object",
        required: true,
        nested: [
            {key: "countryName", type: "string", required: true},
            {key: "capital", type: "string", required: true},
            {key: "alternative_names", type: "array", description: "string[]"},
            {
                key: "coordinates",
                type: "object",
                nested: [
                    {key: "lat", type: "number", required: true},
                    {key: "lng", type: "number", required: true},
                ],
            },
            {key: "verified", type: "boolean"},
        ],
    },
    {
        key: "correct_answer",
        type: "string",
        description: "Long-form ground-truth answer used for eval",
    },
]

// Schema for the kitchen-sink Vanuatu testcase. Mirrors the shape of every
// column the testset's known-union has, so the schema-aware form renders
// every field whether or not this specific row authors it.
export const FIXTURE_KITCHEN_SINK_INFERRED_SCHEMA: SchemaField[] = [
    {key: "country", type: "string", required: true},
    {key: "population_thousands", type: "number"},
    {key: "is_island_nation", type: "boolean"},
    {
        key: "notes",
        type: "string",
        description: "Free-form notes (mixed shape across rows in this testset)",
    },
    {key: "languages", type: "array", description: "ISO language codes"},
    {
        key: "correct_answer",
        type: "string",
        description: "Long-form markdown ground-truth answer",
    },
    {
        key: "inputs",
        type: "object",
        nested: [
            {key: "country", type: "string"},
            {key: "region", type: "string"},
            {key: "population_thousands", type: "number"},
            {key: "is_island_nation", type: "boolean"},
        ],
    },
    {
        key: "outputs",
        type: "object",
        nested: [
            {key: "countryName", type: "string"},
            {key: "capital", type: "string"},
            {
                key: "coordinates",
                type: "object",
                nested: [
                    {key: "lat", type: "number"},
                    {key: "lng", type: "number"},
                    {key: "altitude_m", type: "number"},
                ],
            },
            {key: "verified", type: "boolean"},
        ],
    },
    {
        key: "metadata",
        type: "string",
        description: "Stringified-JSON metadata blob (gap-04 fault line)",
    },
    {
        key: "geo.region",
        type: "string",
        description: "Literal-dotted key — collides with nested `geo.region`",
    },
    {
        key: "geo.subregion",
        type: "string",
        description: "Literal-dotted key (Tuvalu authors this; Vanuatu doesn't)",
    },
    {
        key: "geo",
        type: "object",
        nested: [
            {key: "region", type: "string"},
            {key: "subregion", type: "string"},
            {
                key: "coordinates",
                type: "object",
                nested: [
                    {key: "lat", type: "number"},
                    {key: "lng", type: "number"},
                ],
            },
        ],
    },
    {
        key: "messages",
        type: "array",
        description: "Chat history (system + user + assistant + tool turns)",
    },
]
