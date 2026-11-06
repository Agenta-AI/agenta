/**
 * The feedback fields of a human evaluator, and their round trip through the evaluator's outputs
 * schema. `buildHumanEvaluatorOutputsSchema` writes the schema; `humanEvaluatorMetricsFromSchema`
 * reads it back for the edit form.
 */

/** One feedback field of a human evaluator, as the create and edit forms hold it. */
export interface HumanEvaluatorMetric {
    name: string
    type: string
    optional: boolean
    minimum?: number
    maximum?: number
    enum?: string[]
}

/** The feedback types, in the order the forms offer them. */
export const HUMAN_FEEDBACK_TYPES: readonly {value: string; label: string}[] = [
    {value: "integer", label: "Integer (Discrete)"},
    {value: "number", label: "Decimal (Continuous)"},
    {value: "boolean", label: "Boolean (True/False)"},
    {value: "class", label: "Categorical (Single-choice)"},
    {value: "label", label: "Categorical (Multi-choice)"},
    {value: "string", label: "String (Free note)"},
]

/** Types with a minimum and a maximum. */
export const NUMERIC_FEEDBACK_TYPES: readonly string[] = ["integer", "number"]

/** Types with a list of options. */
export const CHOICE_FEEDBACK_TYPES: readonly string[] = ["class", "label"]

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const enumValues = (value: unknown): string[] =>
    Array.isArray(value)
        ? value
              .filter((item) => item !== null && item !== undefined)
              .map(String)
              .filter(Boolean)
        : []

/**
 * The feedback fields stored in a human evaluator's outputs schema, in schema order. A field is
 * optional when the schema does not list it as required. Returns an empty list for a schema it
 * cannot read.
 */
export function humanEvaluatorMetricsFromSchema(outputs: unknown): HumanEvaluatorMetric[] {
    if (!isRecord(outputs) || !isRecord(outputs.properties)) return []
    const required = Array.isArray(outputs.required) ? outputs.required.map(String) : []

    return Object.entries(outputs.properties).map(([name, raw]) => {
        const schema = isRecord(raw) ? raw : {}
        const optional = !required.includes(name)

        // Single choice: `anyOf: [{type: ["string"], enum}]`.
        if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
            const first = isRecord(schema.anyOf[0]) ? schema.anyOf[0] : {}
            return {name, type: "class", enum: enumValues(first.enum), optional}
        }
        // Multiple choice: an array of enum strings.
        if (schema.type === "array") {
            const items = isRecord(schema.items) ? schema.items : {}
            return {name, type: "label", enum: enumValues(items.enum), optional}
        }

        const metric: HumanEvaluatorMetric = {
            name,
            type: typeof schema.type === "string" ? schema.type : "string",
            optional,
        }
        if (typeof schema.minimum === "number") metric.minimum = schema.minimum
        if (typeof schema.maximum === "number") metric.maximum = schema.maximum
        if (Array.isArray(schema.enum)) metric.enum = enumValues(schema.enum)
        return metric
    })
}
