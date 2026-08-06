import {z} from "zod"

const SYSTEM_FIELDS = new Set([
    "id",
    "key",
    "testset_id",
    "set_id",
    "testset_variant_id",
    "revision_id",
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
    "__isNew",
    "__dedup_id__",
    "testcase_dedup_id",
])

const INTERNAL_USER_DATA_FIELDS = new Set(["testcase_dedup_id"])

const isInternalUserDataField = (key: string): boolean =>
    key.startsWith("__") || INTERNAL_USER_DATA_FIELDS.has(key)

/**
 * Zod schema for testcase entity based on backend API
 * Endpoint: POST /testcases/query
 * Response: TestcasesResponse { count, testcases: Testcase[] }
 *
 * Backend structure (Python):
 * class Testcase(Blob, TestsetIdAlias):
 *   - Blob fields: id, created_at, updated_at, deleted_at, flags, tags, meta, data, set_id
 *   - TestsetIdAlias: testset_id (alias for set_id)
 */

// Helper schemas for nested JSON types
const labelJsonSchema: z.ZodType<
    boolean | string | Record<string, boolean | string | Record<string, any>>
> = z.union([z.boolean(), z.string(), z.lazy(() => z.record(z.string(), labelJsonSchema))])

const fullJsonSchema: z.ZodType<any> = z.lazy(() =>
    z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.record(z.string(), fullJsonSchema),
        z.array(fullJsonSchema),
    ]),
)

/**
 * Complete testcase schema matching backend API
 * Note: Using lenient string() for datetime fields as API may return various formats
 */
export const testcaseSchema = z.object({
    // Identifier
    id: z.string(),

    // Lifecycle - use string() instead of datetime() for flexibility
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional(),
    created_by_id: z.string().nullable().optional(),
    updated_by_id: z.string().nullable().optional(),
    deleted_by_id: z.string().nullable().optional(),

    // Metadata
    flags: z.record(z.string(), labelJsonSchema).nullable().optional(),
    tags: z.record(z.string(), labelJsonSchema).nullable().optional(),
    meta: z.record(z.string(), fullJsonSchema).nullable().optional(),

    // Data (the actual testcase content - dynamic columns)
    data: z.record(z.string(), fullJsonSchema).nullable().optional(),

    // Testset relationship
    testset_id: z.string().nullable().optional(),
    set_id: z.string().nullable().optional(),
})

/**
 * TypeScript type inferred from schema
 */
export type Testcase = z.infer<typeof testcaseSchema>

/**
 * Flattened testcase for table display
 * Data fields are merged into the top level for column access
 */
export const flattenedTestcaseSchema = testcaseSchema.omit({data: true}).passthrough() // Allow additional properties from data field

export type FlattenedTestcase = z.infer<typeof flattenedTestcaseSchema> & Record<string, any>

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

const TESTCASE_ENTITY_MARKER_FIELDS = new Set([
    "id",
    "key",
    "testset_id",
    "set_id",
    "testset_variant_id",
    "revision_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
])

const TESTCASE_ENTITY_UPDATE_MARKER_FIELDS = new Set([
    "id",
    "key",
    "testset_id",
    "set_id",
    "testset_variant_id",
    "revision_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
])

const isTestcaseEntityUpdate = (updates: Record<string, unknown>): boolean =>
    isRecord(updates.data) ||
    (Object.prototype.hasOwnProperty.call(updates, "data") &&
        Object.keys(updates).some((key) => TESTCASE_ENTITY_UPDATE_MARKER_FIELDS.has(key)))

const hasWrappedDataShape = (row: Record<string, unknown>): boolean => {
    if (!isRecord(row.data)) return false

    const keys = Object.keys(row)

    return keys.every((key) => key === "data" || SYSTEM_FIELDS.has(key))
}

/**
 * Schema for testcase creation
 */
export const createTestcaseSchema = testcaseSchema
    .omit({
        id: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        created_by_id: true,
        updated_by_id: true,
        deleted_by_id: true,
    })
    .extend({
        data: z.record(z.string(), fullJsonSchema), // Required for creation
    })

export type CreateTestcaseInput = z.infer<typeof createTestcaseSchema>

/**
 * Schema for testcase updates
 */
export const updateTestcaseSchema = testcaseSchema.partial().required({id: true})

export type UpdateTestcaseInput = z.infer<typeof updateTestcaseSchema>

/**
 * Query request schema
 */
export const testcasesQueryRequestSchema = z.object({
    testcase_ids: z.array(z.string()).optional(),
    testset_id: z.string().optional(),
    testset_revision_ref: z
        .object({
            id: z.string().optional(),
        })
        .optional(),
    windowing: z
        .object({
            newest: z.string().optional(),
            oldest: z.string().optional(),
            next: z.string().optional(),
            limit: z.number().optional(),
            order: z.enum(["ascending", "descending"]).optional(),
        })
        .optional(),
})

export type TestcasesQueryRequest = z.infer<typeof testcasesQueryRequestSchema>

/**
 * Query response schema
 */
export const testcasesResponseSchema = z.object({
    count: z.number(),
    testcases: z.array(testcaseSchema),
    windowing: z
        .object({
            newest: z.string().nullable().optional(),
            oldest: z.string().nullable().optional(),
            next: z.string().nullable().optional(),
            limit: z.number().nullable().optional(),
            order: z.enum(["ascending", "descending"]).nullable().optional(),
            interval: z.string().nullable().optional(),
            rate: z.number().nullable().optional(),
        })
        .passthrough() // Allow additional unknown fields
        .nullable()
        .optional(),
})

export type TestcasesResponse = z.infer<typeof testcasesResponseSchema>

/**
 * Transform API testcase to flattened format for table display
 * Note: data fields are spread first, then rest fields override to preserve system fields like id
 */
export function flattenTestcase(testcase: Testcase): FlattenedTestcase {
    const {data, ...rest} = testcase
    const flattened = {
        // Spread data fields first (column values)
        ...(isRecord(data) ? data : {}),
        // Then spread rest to preserve system fields (id, testset_id, etc.)
        ...rest,
    } as FlattenedTestcase

    if (data !== undefined) {
        flattened.data = data
    }

    return flattened
}

/**
 * Normalize unknown testcase-like input to flattened testcase shape.
 *
 * Handles mixed shapes that appear in UI state/cache:
 * - Flat row: `{id, input, expected}`
 * - Wrapped row: `{id, data: {input, expected}}`
 * - Wrapped in testcase key: `{testcase: {...}}`
 */
export function normalizeToFlattenedTestcase(input: unknown): FlattenedTestcase | null {
    if (!isRecord(input)) return null

    const base = isRecord(input.testcase) ? input.testcase : input

    if (hasWrappedDataShape(base)) {
        const data = isRecord(base.data) ? base.data : {}
        const {data: _data, ...rest} = base

        return {
            ...data,
            ...rest,
            data,
        } as unknown as FlattenedTestcase
    }

    return base as FlattenedTestcase
}

/**
 * Extract user-editable testcase fields from mixed testcase row shapes.
 * Removes all system/internal fields from the normalized row.
 */
export function extractTestcaseUserData(input: unknown): Record<string, unknown> | null {
    const normalized = normalizeToFlattenedTestcase(input)
    if (!normalized) return null

    if (isRecord(normalized.data)) {
        const data: Record<string, unknown> = {}

        for (const [key, value] of Object.entries(normalized.data)) {
            if (!isInternalUserDataField(key)) {
                data[key] = value
            }
        }

        for (const [key, value] of Object.entries(normalized)) {
            if (!SYSTEM_FIELDS.has(key) && key !== "data") {
                data[key] = value
            }
        }

        return data
    }

    const stripSystemFields = Object.keys(normalized).some((key) =>
        TESTCASE_ENTITY_MARKER_FIELDS.has(key),
    )
    const data: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(normalized)) {
        if (key === "data") continue
        if (isInternalUserDataField(key)) continue
        if (!stripSystemFields || !SYSTEM_FIELDS.has(key)) {
            data[key] = value
        }
    }

    return data
}

export function deriveTestcaseColumnKeys(testcases: unknown[]): string[] {
    const columnMap = new Map<string, string>()

    for (const testcase of testcases) {
        const userData = extractTestcaseUserData(testcase)
        if (!userData) continue

        for (const key of Object.keys(userData)) {
            const lowerKey = key.toLowerCase()
            if (!columnMap.has(lowerKey)) {
                columnMap.set(lowerKey, key)
            }
        }
    }

    return Array.from(columnMap.values())
}

export function filterTestcaseUserDataToColumns(
    input: unknown,
    currentColumnKeys: Set<string>,
    useCurrentColumns = true,
): Record<string, unknown> {
    const userData = extractTestcaseUserData(input)
    if (!userData) return {}

    if (!useCurrentColumns) return userData

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(userData)) {
        if (currentColumnKeys.has(key)) {
            result[key] = value
        }
    }

    return result
}

const sortComparableValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map(sortComparableValue)
    }

    if (isRecord(value)) {
        const sorted: Record<string, unknown> = {}
        for (const key of Object.keys(value).sort()) {
            sorted[key] = sortComparableValue(value[key])
        }
        return sorted
    }

    return value
}

const normalizeUserDataValueForComparison = (value: unknown): string =>
    value === undefined || value === null || value === ""
        ? ""
        : JSON.stringify(sortComparableValue(value))

export function hasTestcaseUserDataChanges(current: unknown, original: unknown): boolean {
    const currentUserData = extractTestcaseUserData(current) ?? {}
    const originalUserData = extractTestcaseUserData(original) ?? {}

    const currentKeys = Object.keys(currentUserData)
    const originalKeys = Object.keys(originalUserData)

    for (const key of currentKeys) {
        if (!(key in originalUserData)) {
            const currentValue = currentUserData[key]
            if (currentValue !== undefined && currentValue !== null && currentValue !== "") {
                return true
            }
            continue
        }

        if (
            normalizeUserDataValueForComparison(currentUserData[key]) !==
            normalizeUserDataValueForComparison(originalUserData[key])
        ) {
            return true
        }
    }

    for (const key of originalKeys) {
        if (!(key in currentUserData)) {
            const originalValue = originalUserData[key]
            if (originalValue !== undefined && originalValue !== null && originalValue !== "") {
                return true
            }
        }
    }

    return false
}

export function applyTestcaseUserDataUpdates(
    flattened: FlattenedTestcase,
    updates: Record<string, unknown>,
): FlattenedTestcase {
    const currentData = extractTestcaseUserData(flattened) ?? {}
    const sanitizedUpdates = isTestcaseEntityUpdate(updates)
        ? (extractTestcaseUserData(updates) ?? {})
        : updates
    const nextData: Record<string, unknown> = {...currentData}
    const next: FlattenedTestcase & Record<string, unknown> = {...flattened, data: nextData}

    for (const [key, value] of Object.entries(sanitizedUpdates)) {
        if (key === "data") continue
        if (isInternalUserDataField(key)) continue

        if (value === undefined) {
            delete nextData[key]
            if (!SYSTEM_FIELDS.has(key)) {
                delete next[key]
            }
            continue
        }

        nextData[key] = value
        if (!SYSTEM_FIELDS.has(key)) {
            next[key] = value
        }
    }

    return next
}

/**
 * Transform flattened testcase back to API format
 */
export function unflattenTestcase(flattened: FlattenedTestcase): Testcase {
    const {
        id,
        created_at,
        updated_at,
        deleted_at,
        created_by_id,
        updated_by_id,
        deleted_by_id,
        flags,
        tags,
        meta,
        data: _data,
        testset_id,
        set_id,
        ..._flatData
    } = flattened
    const data = extractTestcaseUserData(flattened) ?? {}

    return testcaseSchema.parse({
        id,
        created_at,
        updated_at,
        deleted_at,
        created_by_id,
        updated_by_id,
        deleted_by_id,
        flags,
        tags,
        meta,
        testset_id,
        set_id,
        data,
    })
}

/**
 * Testset metadata schema
 */
export const testsetMetadataSchema = z.object({
    name: z.string(),
    columns: z.array(z.string()),
    testsetId: z.string(),
    revisionVersion: z.number().optional(),
})

export type TestsetMetadata = z.infer<typeof testsetMetadataSchema>
