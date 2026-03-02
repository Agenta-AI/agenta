import {z} from "zod"

/**
 * Zod schema for testcase entity based on backend API
 * Endpoint: POST /preview/testcases/query
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
    testset_revision_id: z.string().optional(),
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
    return {
        // Spread data fields first (column values)
        ...(data || {}),
        // Then spread rest to preserve system fields (id, testset_id, etc.)
        ...rest,
    }
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
