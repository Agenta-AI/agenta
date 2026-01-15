/**
 * Testset Entity Schemas
 *
 * Zod schemas for validation and type safety of testset entities.
 * These are the core data types used throughout the application.
 *
 * @example
 * ```typescript
 * import {
 *     revisionSchema,
 *     revisionSchemas,
 *     testsetSchema,
 *     testsetSchemas,
 *     normalizeRevision,
 * } from '@agenta/entities/testset'
 *
 * // Parse API response
 * const revision = revisionSchema.parse(apiResponse)
 *
 * // Create local testset with validation
 * const local = testsetSchemas.local.parse({ name: 'My Testset' })
 * ```
 */

import {z} from "zod"

import {createEntitySchemaSet, timestampFieldsSchema, safeParseWithLogging} from "../../shared"

// ============================================================================
// REVISION SCHEMA
// ============================================================================

/**
 * Complete revision schema matching backend API
 * Endpoint: POST /preview/testsets/revisions/query
 *
 * Revisions are immutable snapshots of testset data.
 */
export const revisionSchema = z.object({
    // Identifier
    id: z.string(),

    // Parent testset and variant
    testset_id: z.string(),
    testset_variant_id: z.string().optional(),

    // Header fields (from Header mixin)
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    slug: z.string().nullable().optional(),

    // Version number (0 = draft, 1+ = committed)
    version: z.union([z.number(), z.string()]).transform((v) => {
        return typeof v === "string" ? parseInt(v, 10) : v
    }),

    // Commit fields (from Commit mixin)
    author: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    message: z.string().nullable().optional(),

    // Lifecycle timestamps
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),

    // Author (alias for created_by_id in some responses)
    created_by_id: z.string().nullable().optional(),

    // Flags for quick checks
    flags: z
        .object({
            has_testcases: z.boolean().optional(),
            has_traces: z.boolean().optional(),
        })
        .nullable()
        .optional(),

    // Data containing testcase references
    data: z
        .object({
            testcase_ids: z.array(z.string()).optional(),
            testcases: z.array(z.record(z.string(), z.any())).optional(),
        })
        .nullable()
        .optional(),
})

export type Revision = z.infer<typeof revisionSchema>

/**
 * Revision schema set for create/update/local operations
 *
 * @example
 * ```typescript
 * // Create local revision with defaults
 * const local = revisionSchemas.local.parse({ testset_id: 'ts-123' })
 * // Result: { id: 'local-xxx', testset_id: 'ts-123', version: 0, ... }
 * ```
 */
export const revisionSchemas = createEntitySchemaSet({
    base: revisionSchema,
    serverFields: ["created_at", "updated_at", "created_by_id", "testset_variant_id"],
    localDefaults: {
        version: 0,
        message: null,
        author: null,
        flags: {has_testcases: false},
        data: {testcase_ids: [], testcases: []},
    },
})

export type CreateRevision = typeof revisionSchemas.types.Create
export type UpdateRevision = typeof revisionSchemas.types.Update
export type LocalRevision = typeof revisionSchemas.types.Local

/**
 * Revision list item - lighter version for lists
 */
export const revisionListItemSchema = z.object({
    id: z.string(),
    version: z.union([z.number(), z.string()]).transform((v) => {
        return typeof v === "string" ? parseInt(v, 10) : v
    }),
    created_at: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
    created_by_id: z.string().nullable().optional(),
})

export type RevisionListItem = z.infer<typeof revisionListItemSchema>

/**
 * Query response schema for revisions
 */
export const revisionsResponseSchema = z.object({
    testset_revisions: z.array(revisionSchema),
    count: z.number().optional(),
    windowing: z
        .object({
            newest: z.string().nullable().optional(),
            oldest: z.string().nullable().optional(),
            next: z.string().nullable().optional(),
            limit: z.number().nullable().optional(),
            order: z.enum(["ascending", "descending"]).nullable().optional(),
        })
        .nullable()
        .optional(),
})

export type RevisionsResponse = z.infer<typeof revisionsResponseSchema>

// ============================================================================
// TESTSET SCHEMA
// ============================================================================

/**
 * Testset schema (parent of revisions)
 */
export const testsetSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable().optional(),
        project_id: z.string().nullable().optional(),
    })
    .merge(timestampFieldsSchema)

export type Testset = z.infer<typeof testsetSchema>

/**
 * Testset schema set for create/update/local operations
 *
 * @example
 * ```typescript
 * // Create local testset with defaults
 * const local = testsetSchemas.local.parse({ name: 'My Testset' })
 * // Result: { id: 'new', name: 'My Testset', description: null, ... }
 * ```
 */
export const testsetSchemas = createEntitySchemaSet({
    base: testsetSchema,
    serverFields: ["created_at", "updated_at", "deleted_at"],
    localDefaults: {
        description: null,
        project_id: null,
    },
    idGenerator: () => "new", // Special ID for unsaved testsets
})

export type CreateTestset = typeof testsetSchemas.types.Create
export type UpdateTestset = typeof testsetSchemas.types.Update
export type LocalTestset = typeof testsetSchemas.types.Local

/**
 * Testset query response
 */
export const testsetsResponseSchema = z.object({
    testsets: z.array(testsetSchema),
    count: z.number().optional(),
})

export type TestsetsResponse = z.infer<typeof testsetsResponseSchema>

// ============================================================================
// VARIANT SCHEMA
// ============================================================================

/**
 * Testset Variant schema (contains name and description)
 */
export const variantSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
})

export type Variant = z.infer<typeof variantSchema>

// ============================================================================
// NORMALIZATION UTILITIES
// ============================================================================

/**
 * System/metadata fields to exclude when normalizing testcase data
 */
const TESTCASE_SYSTEM_FIELDS = new Set([
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
    "__dedup_id__",
])

/**
 * Filter system fields from an object
 */
function filterSystemFields(obj: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        if (!TESTCASE_SYSTEM_FIELDS.has(key)) {
            filtered[key] = value
        }
    }
    return filtered
}

/**
 * Normalize a single testcase from API response
 */
function normalizeTestcase(tc: Record<string, unknown>): Record<string, unknown> {
    const id = tc.id as string | undefined

    if (tc.data && typeof tc.data === "object" && !Array.isArray(tc.data)) {
        return {
            id,
            data: filterSystemFields(tc.data as Record<string, unknown>),
        }
    }

    const userData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(tc)) {
        if (!TESTCASE_SYSTEM_FIELDS.has(key) && key !== "data") {
            userData[key] = value
        }
    }

    return {
        id,
        data: userData,
    }
}

/**
 * Normalize revision from API response
 * Handles field aliases and ensures consistent structure
 */
export function normalizeRevision(raw: unknown): Revision {
    const parsed = safeParseWithLogging(revisionSchema, raw, "[normalizeRevision]")
    if (!parsed) {
        throw new Error("[normalizeRevision] Invalid revision data")
    }

    // Normalize author field (API uses both created_by_id and author)
    if (!parsed.author && parsed.created_by_id) {
        parsed.author = parsed.created_by_id
    }

    // Normalize testcases within data.testcases
    if (parsed.data?.testcases && Array.isArray(parsed.data.testcases)) {
        parsed.data = {
            ...parsed.data,
            testcases: parsed.data.testcases.map((tc) =>
                normalizeTestcase(tc as Record<string, unknown>),
            ),
        }
    }

    return parsed
}

// ============================================================================
// HELPER UTILITIES
// ============================================================================

/**
 * Check if revision is v0 (draft/uncommitted)
 */
export function isV0Revision(revision: Revision | RevisionListItem): boolean {
    return revision.version === 0
}

/**
 * Get display version string
 */
export function getVersionDisplay(revision: Revision | RevisionListItem): string {
    return `v${revision.version}`
}

/**
 * Special testset ID used for new testsets that haven't been saved yet
 * @deprecated Use testsetMolecule.set.create() which generates proper IDs
 */
export const NEW_TESTSET_ID = "new"

/**
 * Check if a testset ID represents a new (unsaved) testset.
 * Supports both legacy "new" ID and molecule-generated IDs (new-*, local-*)
 */
export function isNewTestsetId(id: string | null | undefined): boolean {
    if (!id) return false
    return id === NEW_TESTSET_ID || id.startsWith("new-") || id.startsWith("local-")
}
