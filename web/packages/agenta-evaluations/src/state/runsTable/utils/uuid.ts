/**
 * Tiny local UUID matcher for the runs-table data layer.
 *
 * Inlined from `@/oss/lib/helpers/utils` (`isUuid`) so the relocated module stays free of
 * any `@/oss` import.
 */
export const isUuid = (id: string): boolean => {
    // Check for full UUID format (8-4-4-4-12)
    const fullUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    // Check for just the last segment of a UUID (12 hex characters)
    const uuidSegmentRegex = /^[0-9a-f]{12}$/i

    return fullUuidRegex.test(id) || uuidSegmentRegex.test(id)
}

/**
 * Last `-`-delimited segment of an id (e.g. the short tail of a UUID). Inlined from
 * `@/oss/lib/helpers/utils` (`getUniquePartOfId`) so the relocated run-list view stays free
 * of any `@/oss` import; the OSS copy remains for its other (non-eval) consumers.
 */
export const getUniquePartOfId = (id: string): string => {
    const parts = id.split("-")
    return parts[parts.length - 1]
}
