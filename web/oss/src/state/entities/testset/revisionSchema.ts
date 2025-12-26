import {z} from "zod"

/**
 * Zod schema for testset revision entity based on backend API
 * Endpoint: POST /preview/testsets/revisions/query
 * Response: { testset_revisions: TestsetRevision[] }
 *
 * Revisions are immutable snapshots of testset data.
 * Metadata (name, description) can be edited locally before creating a new revision.
 */

/**
 * Complete revision schema matching backend API
 */
export const revisionSchema = z.object({
    // Identifier
    id: z.string(),

    // Parent testset
    testset_id: z.string(),

    // Header fields (from Header mixin)
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),

    // Version number (0 = draft, 1+ = committed)
    version: z.union([z.number(), z.string()]).transform((v) => {
        // API sometimes returns string, normalize to number
        return typeof v === "string" ? parseInt(v, 10) : v
    }),

    // Commit fields (from Commit mixin)
    author: z.string().nullable().optional(),
    date: z.string().nullable().optional(),
    message: z.string().nullable().optional(), // Commit message

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
        })
        .nullable()
        .optional(),
})

export type Revision = z.infer<typeof revisionSchema>

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

/**
 * Testset schema (parent of revisions)
 */
export const testsetSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
})

export type Testset = z.infer<typeof testsetSchema>

/**
 * Testset query response
 */
export const testsetsResponseSchema = z.object({
    testsets: z.array(testsetSchema),
    count: z.number().optional(),
})

export type TestsetsResponse = z.infer<typeof testsetsResponseSchema>

/**
 * Normalize revision from API response
 * Handles field aliases and ensures consistent structure
 */
export function normalizeRevision(raw: unknown): Revision {
    const parsed = revisionSchema.parse(raw)

    // Normalize author field (API uses both created_by_id and author)
    if (!parsed.author && parsed.created_by_id) {
        parsed.author = parsed.created_by_id
    }

    return parsed
}

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
