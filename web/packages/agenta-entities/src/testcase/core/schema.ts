/**
 * Testcase Schemas
 *
 * Zod schemas for testcase entity validation and transformation.
 * Uses shared schema utilities for consistent patterns.
 *
 * @example
 * ```typescript
 * import {
 *     testcaseSchema,
 *     testcaseSchemas,
 *     flattenTestcase,
 *     unflattenTestcase,
 * } from '@agenta/entities/testcase'
 *
 * // Parse API response
 * const testcase = testcaseSchema.parse(apiResponse)
 *
 * // Create local entity with validation
 * const local = testcaseSchemas.local.parse({ data: { country: 'USA' } })
 *
 * // Flatten for table display (spreads data into columns)
 * const flattened = flattenTestcase(testcase)
 *
 * // Unflatten for API submission
 * const unflattened = unflattenTestcase(flattened)
 * ```
 */

import {z} from "zod"

import {
    createEntitySchemaSet,
    COMMON_SERVER_FIELDS,
    jsonValueSchema,
    safeParseWithLogging,
} from "../../shared"

// ============================================================================
// HELPER SCHEMAS
// ============================================================================

/**
 * Schema for label-like JSON values (used in flags/tags)
 */
const labelJsonSchema: z.ZodType<
    boolean | string | Record<string, boolean | string | Record<string, unknown>>
> = z.union([z.boolean(), z.string(), z.lazy(() => z.record(z.string(), labelJsonSchema))])

// ============================================================================
// TESTCASE SCHEMAS
// ============================================================================

/**
 * Complete testcase schema matching backend API
 *
 * Backend structure (Python):
 * class Testcase(Blob, TestsetIdAlias):
 *   - Blob fields: id, created_at, updated_at, deleted_at, flags, tags, meta, data, set_id
 *   - TestsetIdAlias: testset_id (alias for set_id)
 */
export const testcaseSchema = z.object({
    // Identifier
    id: z.string(),

    // Lifecycle timestamps
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional(),
    created_by_id: z.string().nullable().optional(),
    updated_by_id: z.string().nullable().optional(),
    deleted_by_id: z.string().nullable().optional(),

    // Metadata
    flags: z.record(z.string(), labelJsonSchema).nullable().optional(),
    tags: z.record(z.string(), labelJsonSchema).nullable().optional(),
    meta: z.record(z.string(), jsonValueSchema).nullable().optional(),

    // Data (the actual testcase content - dynamic columns)
    data: z.record(z.string(), jsonValueSchema).nullable().optional(),

    // Testset relationship
    testset_id: z.string().nullable().optional(),
    set_id: z.string().nullable().optional(),
})

/**
 * TypeScript type for testcase
 */
export type Testcase = z.infer<typeof testcaseSchema>

/**
 * Flattened testcase schema for table display
 * Data fields are merged into the top level for column access
 */
export const flattenedTestcaseSchema = testcaseSchema.omit({data: true}).passthrough()

/**
 * TypeScript type for flattened testcase
 * Includes dynamic properties from data field
 */
export type FlattenedTestcase = z.infer<typeof flattenedTestcaseSchema> & Record<string, unknown>

// ============================================================================
// SCHEMA SET (Factory-generated variants)
// ============================================================================

/**
 * Testcase schema set - auto-generates all schema variants from base.
 *
 * @example
 * ```typescript
 * // Parse API response
 * const testcase = testcaseSchemas.base.parse(apiResponse)
 *
 * // Create local entity with validation and defaults
 * const local = testcaseSchemas.local.parse({ data: { country: 'USA' } })
 * // Result: { id: 'new-xxx', data: { country: 'USA' }, flags: {}, ... }
 *
 * // Validate update payload
 * const update = testcaseSchemas.update.parse({ id: 'tc-1', data: { country: 'UK' } })
 * ```
 */
export const testcaseSchemas = createEntitySchemaSet({
    base: testcaseSchema,
    serverFields: [...COMMON_SERVER_FIELDS, "set_id"],
    localDefaults: {
        data: {},
        flags: {},
        tags: {},
        meta: {},
        testset_id: null,
    },
    idGenerator: () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
})

/**
 * Parse testcase with logging (for API boundaries)
 */
export function parseTestcase(data: unknown): Testcase | null {
    return safeParseWithLogging(testcaseSchema, data, "[parseTestcase]")
}

// ============================================================================
// QUERY/RESPONSE SCHEMAS
// ============================================================================

/**
 * Windowing configuration for pagination
 */
export const windowingSchema = z.object({
    newest: z.string().optional(),
    oldest: z.string().optional(),
    next: z.string().optional(),
    limit: z.number().optional(),
    order: z.enum(["ascending", "descending"]).optional(),
})

/**
 * Query request schema for POST /preview/testcases/query
 */
export const testcasesQueryRequestSchema = z.object({
    testcase_ids: z.array(z.string()).optional(),
    testset_id: z.string().optional(),
    testset_revision_id: z.string().optional(),
    windowing: windowingSchema.optional(),
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
        .passthrough()
        .nullable()
        .optional(),
})

export type TestcasesResponse = z.infer<typeof testcasesResponseSchema>

// ============================================================================
// TRANSFORMATION UTILITIES
// ============================================================================

/**
 * Transform API testcase to flattened format for table display
 *
 * Data fields are spread first, then system fields override to preserve
 * id, testset_id, etc.
 *
 * @example
 * ```typescript
 * const testcase = { id: '1', data: { name: 'Test', value: 123 } }
 * const flattened = flattenTestcase(testcase)
 * // { id: '1', name: 'Test', value: 123 }
 * ```
 */
export function flattenTestcase(testcase: Testcase): FlattenedTestcase {
    const {data, ...rest} = testcase
    return {
        // Spread data fields first (column values)
        ...(data || {}),
        // Then spread rest to preserve system fields (id, testset_id, etc.)
        ...rest,
    }
}

/**
 * Transform flattened testcase back to API format
 *
 * System fields are extracted, remaining fields go into data
 *
 * @example
 * ```typescript
 * const flattened = { id: '1', name: 'Test', value: 123 }
 * const testcase = unflattenTestcase(flattened)
 * // { id: '1', data: { name: 'Test', value: 123 } }
 * ```
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
        testset_id,
        set_id,
        ...data
    } = flattened

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

// ============================================================================
// LOCAL TESTCASE FACTORY (FLAT INPUT)
// ============================================================================

/**
 * Result type for createLocalTestcase - success case
 */
export interface CreateLocalTestcaseSuccess {
    success: true
    data: FlattenedTestcase
}

/**
 * Result type for createLocalTestcase - failure case
 */
export interface CreateLocalTestcaseFailure {
    success: false
    errors: string[]
}

/**
 * Result type for createLocalTestcase
 */
export type CreateLocalTestcaseResult = CreateLocalTestcaseSuccess | CreateLocalTestcaseFailure

/**
 * Create a local testcase from FLAT input.
 *
 * This is the primary way to create local testcases. It accepts flat data
 * (like `{ country: 'USA', value: 123 }`) which is what UI components naturally
 * work with, and handles the conversion to the nested API format internally.
 *
 * The result is a FlattenedTestcase ready for storage.
 *
 * @example
 * ```typescript
 * // Create from flat UI data
 * const result = createLocalTestcase({ country: 'USA', value: 123 })
 * if (result.success) {
 *   console.log(result.data) // FlattenedTestcase with id, country, value, etc.
 * }
 *
 * // Create empty testcase
 * const empty = createLocalTestcase()
 * ```
 */
export function createLocalTestcase(
    flatInput?: Partial<FlattenedTestcase>,
): CreateLocalTestcaseResult {
    // Extract system fields from flat input, rest goes into data
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
        testset_id,
        set_id,
        ...dataFields
    } = flatInput ?? {}

    // Build nested input for schema validation
    const nestedInput: Partial<Testcase> = {
        flags: flags ?? {},
        tags: tags ?? {},
        meta: meta ?? {},
        testset_id: testset_id ?? null,
        // Put user data fields into the nested 'data' object
        data: Object.keys(dataFields).length > 0 ? dataFields : {},
    }

    // Include optional system fields if provided
    if (id !== undefined) nestedInput.id = id
    if (created_at !== undefined) nestedInput.created_at = created_at
    if (updated_at !== undefined) nestedInput.updated_at = updated_at
    if (deleted_at !== undefined) nestedInput.deleted_at = deleted_at
    if (created_by_id !== undefined) nestedInput.created_by_id = created_by_id
    if (updated_by_id !== undefined) nestedInput.updated_by_id = updated_by_id
    if (deleted_by_id !== undefined) nestedInput.deleted_by_id = deleted_by_id
    if (set_id !== undefined) nestedInput.set_id = set_id

    // Parse with local schema (generates ID, applies defaults)
    const result = testcaseSchemas.local.safeParse(nestedInput)

    if (!result.success) {
        const errors = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`)
        return {success: false, errors}
    }

    // Flatten for storage (spreads data fields back to top level)
    const flattened = flattenTestcase(result.data)
    return {success: true, data: flattened}
}

// ============================================================================
// TESTSET METADATA SCHEMA
// ============================================================================

/**
 * Testset metadata schema (for table header display)
 */
export const testsetMetadataSchema = z.object({
    name: z.string(),
    columns: z.array(z.string()),
    testsetId: z.string(),
    revisionVersion: z.number().optional(),
})

export type TestsetMetadata = z.infer<typeof testsetMetadataSchema>

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * System fields to exclude from dirty comparison and data operations
 */
export const SYSTEM_FIELDS = new Set([
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
    "testcase_dedup_id",
])

/**
 * Check if a field is a system field
 */
export function isSystemField(field: string): boolean {
    return SYSTEM_FIELDS.has(field)
}
