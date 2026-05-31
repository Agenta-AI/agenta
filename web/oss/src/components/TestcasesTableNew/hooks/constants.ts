/**
 * Returns true when a column key is an internal UI/private path.
 * Testcase system metadata is filtered before column derivation; user data columns
 * may legitimately be named "id", "tags", "flags", "meta", etc.
 *
 * Examples:
 * - "payload.__dedup_id__" -> true
 * - "testcase_dedup_id" -> true
 * - "tags" -> false
 */
export const isSystemColumnPath = (columnKey: string): boolean => {
    if (!columnKey) return false

    const segments = columnKey.split(".")
    return segments.some((s) => s.startsWith("__") || s === "testcase_dedup_id")
}
