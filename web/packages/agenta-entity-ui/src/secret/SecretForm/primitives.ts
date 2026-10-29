// Flat-JSON primitive handling for the custom-secret grid: values stay native
// (string/number/boolean/null) so the type survives the round-trip.
import {inferLogicalType, type LogicalType} from "@agenta/shared/utils"

export type PrimitiveType = "string" | "number" | "boolean" | "null"
export type PrimitiveValue = string | number | boolean | null

export interface KvRow {
    key: string
    value: PrimitiveValue
}

export const PRIMITIVE_TYPES: PrimitiveType[] = ["string", "number", "boolean", "null"]

/** Narrow the shared LogicalType down to our flat primitive set. */
export const primitiveTypeOf = (value: PrimitiveValue): PrimitiveType => {
    const t = inferLogicalType(value) as LogicalType
    return t === "string" || t === "number" || t === "boolean" || t === "null" ? t : "string"
}

/**
 * Re-coerce a value when the user switches its type in the grid. Rules:
 *   → string:  null → ""; boolean → "true"/"false"; else String(value)
 *   → number:  boolean true → 1, false → 0; null → 0; else parse, NaN → 0
 *   → boolean: string → empty/"false"/"False" are false, rest true;
 *              number → empty/0 are false, rest true; null → false
 *   → null:    always null
 */
export const coerceToType = (value: PrimitiveValue, type: PrimitiveType): PrimitiveValue => {
    switch (type) {
        case "string":
            if (value === null) return ""
            return String(value)
        case "number": {
            if (typeof value === "boolean") return value ? 1 : 0
            if (value === null) return 0
            const n = Number(value)
            return Number.isFinite(n) ? n : 0
        }
        case "boolean":
            if (typeof value === "boolean") return value
            if (value === null) return false
            if (typeof value === "number") return value !== 0
            return value !== "" && value.toLowerCase() !== "false"
        case "null":
            return null
    }
}

/** The editable text shown for a primitive value in the grid. */
export const valueToText = (value: PrimitiveValue): string => (value === null ? "" : String(value))

/** Parse the grid's text input back to a native value for the given type. */
export const textToValue = (text: string, type: PrimitiveType): PrimitiveValue => {
    switch (type) {
        case "string":
            return text
        case "number": {
            const n = Number(text)
            return Number.isFinite(n) ? n : 0
        }
        case "boolean":
            return text === "true"
        case "null":
            return null
    }
}

/** True when `value` is a flat object of JSON primitives (no nesting/arrays). */
export const isFlatPrimitiveObject = (value: unknown): value is Record<string, PrimitiveValue> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    return Object.values(value).every(
        (v) => v === null || ["string", "number", "boolean"].includes(typeof v),
    )
}

export const rowsToObject = (rows: KvRow[]): Record<string, PrimitiveValue> =>
    Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]))

export const objectToRows = (value: unknown): KvRow[] => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const rows = Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
            key,
            value: (v === null || ["string", "number", "boolean"].includes(typeof v)
                ? v
                : String(v)) as PrimitiveValue,
        }))
        if (rows.length) return rows
    }
    return [{key: "", value: ""}]
}
