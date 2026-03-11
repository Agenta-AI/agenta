/**
 * System columns that should not be displayed or edited
 */
export const SYSTEM_COLUMNS = [
    "id",
    "key",
    "testset_id",
    "set_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
    "flags",
    "tags",
    "meta",
    "__isSkeleton",
    "__dedup_id__",
    "testcase_dedup_id",
]

const SYSTEM_COLUMN_SET = new Set(SYSTEM_COLUMNS)

/**
 * Returns true when a column key is internal/system, including nested paths.
 * Examples:
 * - "testcase_dedup_id" -> true
 * - "data.testcase_dedup_id" -> true
 * - "payload.__dedup_id__" -> true
 */
export const isSystemColumnPath = (columnKey: string): boolean => {
    if (!columnKey) return false

    return columnKey.split(".").some((segment) => SYSTEM_COLUMN_SET.has(segment))
}
