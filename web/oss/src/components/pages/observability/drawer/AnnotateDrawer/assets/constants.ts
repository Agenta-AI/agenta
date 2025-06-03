// As for checkpoint-2 (23/05/2025) we are only using these metric types
export const USEABLE_METRIC_TYPES = [
    "number",
    "integer",
    "float",
    "boolean",
    "string",
    "array",
    "class",
]
export const NUMERIC_METRIC_TYPES = ["number", "integer", "float"]

// ref: https://swagger.io/docs/specification/v3_0/data-models/data-types/#numbers
const METRIC_TYPES = {
    integer: "Integer (Discrete)",
    number: "Decimal (Continuous)",
    boolean: "Boolean (True/False)",
    class: "Categorical (Single-choice)",
    label: "Categorical (Multi-choice)",
    string: "String (Free note)",
} as const

export const EVALUATOR_OPTIONS = Object.entries(METRIC_TYPES).map(([value, label]) => ({
    value,
    label,
}))
