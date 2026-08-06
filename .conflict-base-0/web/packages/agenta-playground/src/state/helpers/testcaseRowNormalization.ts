import {isRecord} from "@agenta/entities/shared"
import {SYSTEM_FIELDS} from "@agenta/entities/testcase"

/**
 * Fields that hint at a wrapper object (i.e. system fields minus non-hint keys)
 * Used to detect whether a row object is a raw testcase wrapper or actual data.
 */
const NON_HINT_FIELDS = new Set(["id", "key", "__isSkeleton", "__isNew", "__dedup_id__"])
const WRAPPER_HINT_FIELDS = new Set([...SYSTEM_FIELDS].filter((f) => !NON_HINT_FIELDS.has(f)))

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface CanonicalTestcaseRow {
    id?: string
    data: Record<string, unknown>
}

const looksLikeTestcaseId = (value: unknown): boolean =>
    typeof value === "string" &&
    (UUID_PATTERN.test(value) ||
        value.startsWith("new-") ||
        value.startsWith("local-") ||
        value.startsWith("testcase-"))

const unwrapTestcaseObject = (input: Record<string, unknown>): Record<string, unknown> => {
    let current: Record<string, unknown> = input
    const seen = new Set<Record<string, unknown>>()

    while (isRecord(current.testcase) && !seen.has(current)) {
        seen.add(current)
        current = current.testcase
    }

    return current
}

const hasWrappedDataShape = (row: Record<string, unknown>): boolean => {
    if (!isRecord(row.data)) return false

    const keys = Object.keys(row)
    if (keys.length === 1 && keys[0] === "data") return true

    if (keys.some((key) => WRAPPER_HINT_FIELDS.has(key))) return true

    if (!keys.every((key) => key === "id" || key === "data" || SYSTEM_FIELDS.has(key))) {
        return false
    }

    if (keys.length === 2 && keys.includes("id") && keys.includes("data")) {
        return looksLikeTestcaseId(row.id)
    }

    return true
}

export const extractCanonicalTestcaseRow = (row: Record<string, unknown>): CanonicalTestcaseRow => {
    const unwrapped = unwrapTestcaseObject(row)
    const id = typeof unwrapped.id === "string" ? unwrapped.id : undefined

    const sourceData = hasWrappedDataShape(unwrapped)
        ? (unwrapped.data as Record<string, unknown>)
        : unwrapped

    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(sourceData)) {
        if (!SYSTEM_FIELDS.has(key)) {
            data[key] = value
        }
    }

    return {id, data}
}

export const normalizeTestcaseRowsForLoad = (
    rows: Record<string, unknown>[],
): CanonicalTestcaseRow[] => {
    return rows.map((row) => extractCanonicalTestcaseRow(row))
}
