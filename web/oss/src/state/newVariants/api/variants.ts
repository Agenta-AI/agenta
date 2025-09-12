import {fetchJson} from "@/oss/lib/api/assets/fetchClient"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import type {ApiVariant, ApiRevision, VariantRevision} from "@/oss/lib/Types"

/**
 * Revision-Centric Variants API Layer
 *
 * Key Concepts:
 * - Variants point to their latest revision (variant.revision is the latest revision number)
 * - UI components primarily work with revisions, not variants
 * - Revisions represent the actual configuration data and history
 * - API endpoints: /apps/{appId}/variants and /variants/{variantId}/revisions
 */

// Helper functions
function getBaseUrl(): string {
    return process.env.NEXT_PUBLIC_AGENTA_API_URL || "http://localhost"
}

function ensureProjectId(): string | null {
    return process.env.VITEST_TEST_PROJECT_ID || null
}

function ensureAppId(appId?: string): string {
    return appId || process.env.VITEST_TEST_APP_ID || ""
}

// Core API response types
export interface VariantQueryResponse {
    variants: ApiVariant[]
    total: number
    has_more: boolean
}

export interface VariantQueryOptions {
    offset?: number
    limit?: number
    search?: string
    filters?: Record<string, any>
}

export interface RevisionQueryOptions {
    offset?: number
    limit?: number
}

// Transform ApiRevision to VariantRevision with computed fields
function transformRevision(
    apiRevision: ApiRevision,
    variantId: string,
    isLatest = false,
): VariantRevision {
    return {
        ...snakeToCamelCaseKeys(apiRevision),
        variantId,
        isLatestRevision: isLatest,
        createdAtTimestamp: Date.parse(apiRevision.created_at),
        updatedAtTimestamp: Date.parse(apiRevision.updated_at),
    }
}

// Transform ApiVariant to VariantRevision with computed fields
export function variantToRevision(apiVariant: ApiVariant): VariantRevision {
    return {
        id: `${apiVariant.variant_id}_${apiVariant.revision}`,
        revision: apiVariant.revision,
        modifiedBy: apiVariant.modified_by_id,
        config: {
            configName: apiVariant.config_name,
            parameters: apiVariant.parameters,
        },
        createdAt: apiVariant.created_at,
        commitMessage: null,
        variantId: apiVariant.variant_id,
        isLatestRevision: true,
        createdAtTimestamp: Date.parse(apiVariant.created_at),
        updatedAtTimestamp: Date.parse(apiVariant.updated_at),
    }
}

/**
 * Fetch all variants for an app (these represent latest revisions)
 * Used for: variant selection, latest revision info
 */
export const fetchAppVariants = async (
    appId: string,
    options: VariantQueryOptions = {},
): Promise<VariantQueryResponse> => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()
    const app = ensureAppId(appId)
    console.log("fetchAppVariants")
    const url = new URL(`api/apps/${app}/variants`, base)

    if (projectId) url.searchParams.set("project_id", String(projectId))
    if (options.search) url.searchParams.set("search", options.search)
    if (options.offset) url.searchParams.set("offset", String(options.offset))
    if (options.limit) url.searchParams.set("limit", String(options.limit))

    const data = (await fetchJson(url)) as ApiVariant[]

    return {
        variants: data,
        total: data.length,
        has_more: false,
    }
}

/**
 * Fetch revisions for a specific variant
 * Used for: revision history, variant-grouped registry view
 */
export const fetchVariantRevisions = async (
    variantId: string,
    options: RevisionQueryOptions = {},
): Promise<VariantRevision[]> => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()
    console.log("fetchVariantRevisions")
    const url = new URL(`api/variants/${variantId}/revisions`, base)

    if (projectId) url.searchParams.set("project_id", String(projectId))
    if (options.offset) url.searchParams.set("offset", String(options.offset))
    if (options.limit) url.searchParams.set("limit", String(options.limit))

    const data = (await fetchJson(url)) as ApiRevision[]

    // Transform to VariantRevision with computed fields
    return data.map(
        (rev, index) => transformRevision(rev, variantId, index === 0), // First revision is latest
    )
}

/**
 * Fetch latest N revisions across all variants
 * Used for: overview table showing latest 5 revisions
 */
export const fetchLatestRevisions = async (
    appId: string,
    limit = 5,
): Promise<VariantRevision[]> => {
    // Get all variants (which represent latest revisions)
    const variantsResponse = await fetchAppVariants(appId)

    // Transform variants to revisions and sort by timestamp
    const latestRevisions = variantsResponse.variants
        .map(variantToRevision)
        .sort((a, b) => b.updatedAtTimestamp - a.updatedAtTimestamp)
        .slice(0, limit)

    return latestRevisions
}

/**
 * Fetch all revisions across all variants
 * Used for: registry page in revision mode
 */
export const fetchAllRevisions = async (
    appId: string,
    options: RevisionQueryOptions = {},
): Promise<VariantRevision[]> => {
    // Get all variants first
    const variantsResponse = await fetchAppVariants(appId)
    const allRevisions: VariantRevision[] = []

    // Fetch revisions for each variant
    for (const variant of variantsResponse.variants) {
        try {
            const revisions = await fetchVariantRevisions(variant.variant_id, options)
            allRevisions.push(...revisions)
        } catch (error) {
            console.warn(`Failed to fetch revisions for variant ${variant.variant_id}:`, error)
        }
    }

    // Sort by timestamp
    return allRevisions.sort((a, b) => b.updatedAtTimestamp - a.updatedAtTimestamp)
}

/**
 * Fetch individual variant by ID (returns latest revision info)
 * Used for: single variant details
 */
export const fetchVariantById = async (variantId: string): Promise<ApiVariant> => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()
    console.log("fetchVariantById", variantId)
    const url = new URL(`api/variants/${variantId}`, base)
    if (projectId) url.searchParams.set("project_id", String(projectId))
    return fetchJson(url) as Promise<ApiVariant>
}

/**
 * Fetch specific revision by variant ID and revision number
 * Used for: revision navigation, deep linking
 */
export const fetchRevisionByNumber = async (
    variantId: string,
    revisionNumber: number,
): Promise<VariantRevision> => {
    const base = getBaseUrl()
    const projectId = ensureProjectId()
    const url = new URL(`api/variants/${variantId}/revisions/${revisionNumber}`, base)
    if (projectId) url.searchParams.set("project_id", String(projectId))

    const apiRevision = (await fetchJson(url)) as ApiRevision
    return transformRevision(apiRevision, variantId)
}
