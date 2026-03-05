/**
 * LegacyAppRevision API Functions
 *
 * HTTP functions and data transformers for OSS app revision entity.
 * Uses the legacy backend API endpoints:
 * - GET /variants/{variant_id}/revisions/{revision_number}/
 * - POST /variants/revisions/query/
 *
 * @packageDocumentation
 */

import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {createBatchFetcher, dereferenceSchema} from "@agenta/shared/utils"

import {
    // URI parsing
    parseRevisionUri,
    // Revision parameter extraction
    extractRevisionParameters,
    // List item types (re-export)
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    // API response types (re-export)
    type ApiVariant,
    type ApiRevisionListItem,
    type ApiApp,
    // Transform utilities
    transformAppToListItem,
    transformVariantToListItem,
    transformRevisionToListItem,
    // Validation
    isValidUUID,
    // Enhanced variant types
    type EnhancedVariantLike,
    extractUriFromEnhanced,
} from "../../shared"
import type {LegacyAppRevisionData, ApiAppVariantRevision} from "../core"

// Re-export shared types for consumers
export type {
    AppListItem,
    VariantListItem,
    RevisionListItem,
    ApiVariant,
    ApiRevisionListItem,
    ApiApp,
}
export {isValidUUID}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Request model for querying revisions by IDs
 * Maps to: RevisionsQueryRequest in variants_router.py
 */
export interface RevisionsQueryRequest {
    revision_ids: string[]
}

/**
 * Response model for revision query
 * Maps to: RevisionsQueryResponse in variants_router.py
 */
export interface RevisionsQueryResponse {
    count: number
    revisions: ApiAppVariantRevision[]
}

// List item types imported from shared/utils/revisionUtils

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================

/**
 * Context for enhanced transformation
 * Provides additional data not available in the API response
 */
export interface TransformContext {
    /** The variant ID (not in revision query response) */
    variantId?: string
    /** The app ID (not in revision query response) */
    appId?: string
    /** The variant name */
    variantName?: string
    /** The app name */
    appName?: string
    /** The service URI for schema fetching */
    uri?: string
    /** Whether this is the latest revision */
    isLatestRevision?: boolean
}

/**
 * Transform ApiAppVariantRevision to LegacyAppRevisionData
 *
 * The backend returns:
 * - id: revision UUID (can be null)
 * - revision: revision number
 * - modified_by: author name
 * - config: { config_name, parameters }
 * - created_at: ISO timestamp
 * - commit_message: optional note
 *
 * @param apiRevision - Raw revision from backend
 * @param context - Additional context for enhanced transformation
 */
export function transformApiRevision(
    apiRevision: ApiAppVariantRevision,
    context?: TransformContext | string,
    appId?: string,
): LegacyAppRevisionData {
    // Support legacy signature: (apiRevision, variantId, appId)
    const ctx: TransformContext =
        typeof context === "string" ? {variantId: context, appId} : context || {}

    const config = apiRevision.config || {config_name: "", parameters: {}}
    const parameters = config.parameters || {}

    // Extract revision parameters using shared utility
    const revisionParameters = extractRevisionParameters(parameters)

    // Extract URI info if provided
    const uriInfo = parseRevisionUri(ctx.uri)

    const result: LegacyAppRevisionData = {
        id: apiRevision.id || `${ctx.variantId}_rev_${apiRevision.revision}`,
        variantId: ctx.variantId ?? apiRevision.variant_id ?? undefined,
        appId: ctx.appId,
        revision: apiRevision.revision || 1,
        isLatestRevision: ctx.isLatestRevision,
        variantName: ctx.variantName,
        appName: ctx.appName,
        configName: config.config_name,
        parameters: revisionParameters,
        modifiedBy: apiRevision.modified_by,
        commitMessage: apiRevision.commit_message,
        createdAt: apiRevision.created_at,
        // URI and runtime info
        uri: ctx.uri,
        runtimePrefix: uriInfo?.runtimePrefix,
        routePath: uriInfo?.routePath,
    }

    return result
}

/**
 * Transform EnhancedVariantLike to LegacyAppRevisionData
 *
 * This enables transformation of enhanced variant data (from OSS playground)
 * to the legacyAppRevision format, similar to appRevision's transformEnhancedVariant.
 *
 * @param enhanced - Enhanced variant-like object with full data
 */
export function transformEnhancedVariant(enhanced: EnhancedVariantLike): LegacyAppRevisionData {
    // Extract URI info using shared utility
    const uriInfo = extractUriFromEnhanced(enhanced)

    // Extract revision parameters using shared utility
    const revisionParameters = extractRevisionParameters(enhanced.parameters)

    return {
        id: enhanced.id,
        variantId: enhanced.variantId,
        appId: enhanced.appId,
        revision: Number(enhanced.revision) || 1,
        configName: undefined, // Not available in enhanced format
        parameters: revisionParameters,
        createdAt: enhanced.createdAt || enhanced.created_at,
        updatedAt: enhanced.updatedAt || enhanced.updated_at,
        // URI and runtime info
        uri: enhanced.uri || enhanced.url,
        runtimePrefix: uriInfo?.runtimePrefix,
        routePath: uriInfo?.routePath,
    }
}

// transformAppToListItem imported from shared/utils/revisionUtils

// ============================================================================
// REVISION FETCH API
// ============================================================================

/**
 * Fetch a single revision by variant ID and revision number
 *
 * Uses: GET /variants/{variant_id}/revisions/{revision_number}/
 *
 * @param variantId - The variant ID
 * @param revisionNumber - The revision number
 * @param projectId - The project ID
 * @returns LegacyAppRevisionData or null if not found
 */
export async function fetchOssRevision(
    variantId: string,
    revisionNumber: number,
    projectId: string,
): Promise<LegacyAppRevisionData | null> {
    if (!variantId || !projectId || revisionNumber < 1) return null

    try {
        const response = await axios.get<ApiAppVariantRevision>(
            `${getAgentaApiUrl()}/variants/${variantId}/revisions/${revisionNumber}/`,
            {
                params: {project_id: projectId},
            },
        )

        if (!response.data) return null

        return transformApiRevision(response.data, variantId)
    } catch (error) {
        console.error("[fetchOssRevision] Failed to fetch revision", {
            variantId,
            revisionNumber,
            error,
        })
        return null
    }
}

/**
 * Fetch a single revision by its ID
 *
 * Uses: POST /variants/revisions/query/
 * Also fetches variant detail to get URI for schema fetching.
 *
 * @param revisionId - The revision ID (UUID)
 * @param projectId - The project ID
 * @returns LegacyAppRevisionData or null if not found
 */
export async function fetchOssRevisionById(
    revisionId: string,
    projectId: string,
): Promise<LegacyAppRevisionData | null> {
    if (!revisionId || !projectId) return null

    try {
        const response = await axios.post<RevisionsQueryResponse>(
            `${getAgentaApiUrl()}/variants/revisions/query/`,
            {
                revision_ids: [revisionId],
            } as RevisionsQueryRequest,
            {
                params: {project_id: projectId},
            },
        )

        if (!response.data?.revisions?.length) {
            return null
        }

        const apiRevision = response.data.revisions[0]

        // If we have variant_id, fetch variant detail to get URI
        // Uses batch fetcher for deduplication across concurrent revision fetches
        const variantId = apiRevision.variant_id
        if (variantId) {
            const variantDetail = await variantDetailBatchFetcher({variantId, projectId})
            if (variantDetail) {
                const result = transformApiRevision(apiRevision, {
                    variantId,
                    appId: variantDetail.appId,
                    variantName: variantDetail.name,
                    appName: variantDetail.appName,
                    uri: variantDetail.uri,
                })
                return result
            }
        }

        // Fallback: return with variantId from API response if available
        return transformApiRevision(apiRevision, {variantId: variantId || undefined})
    } catch (error) {
        console.error("[fetchOssRevisionById] Failed to fetch revision", {
            revisionId,
            error,
        })
        return null
    }
}

/**
 * Batch fetch multiple revisions by their IDs
 *
 * Uses: POST /variants/revisions/query/
 *
 * @param revisionIds - Array of revision IDs (UUIDs)
 * @param projectId - The project ID
 * @returns Array of LegacyAppRevisionData
 */
export async function fetchOssRevisionsBatch(
    revisionIds: string[],
    projectId: string,
): Promise<LegacyAppRevisionData[]> {
    if (!revisionIds.length || !projectId) return []

    try {
        const response = await axios.post<RevisionsQueryResponse>(
            `${getAgentaApiUrl()}/variants/revisions/query/`,
            {
                revision_ids: revisionIds,
            } as RevisionsQueryRequest,
            {
                params: {project_id: projectId},
            },
        )

        if (!response.data?.revisions?.length) return []

        return response.data.revisions.map((rev) => transformApiRevision(rev))
    } catch (error) {
        console.error("[fetchOssRevisionsBatch] Failed to fetch revisions", {
            revisionIds,
            error,
        })
        return []
    }
}

// ============================================================================
// BATCH FETCHERS
// ============================================================================

/**
 * Batched revision fetcher — collects individual revision requests within a
 * short window and executes a single bulk `POST /variants/revisions/query/`.
 *
 * Each result is enriched with variant detail (URI, app context) via the
 * variant detail batch fetcher, which deduplicates across callers.
 */
export const revisionBatchFetcher = createBatchFetcher<
    {revisionId: string; projectId: string},
    LegacyAppRevisionData | null
>({
    maxBatchSize: 50,
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.revisionId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, LegacyAppRevisionData | null>()

        // Group by projectId
        const byProject = new Map<string, {revisionIds: string[]; keyMap: Map<string, string>}>()
        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!req.revisionId || !req.projectId) {
                results.set(key, null)
                return
            }
            let group = byProject.get(req.projectId)
            if (!group) {
                group = {revisionIds: [], keyMap: new Map()}
                byProject.set(req.projectId, group)
            }
            group.revisionIds.push(req.revisionId)
            group.keyMap.set(req.revisionId, key)
        })

        for (const [projectId, group] of byProject) {
            try {
                const revisions = await fetchOssRevisionsBatch(group.revisionIds, projectId)

                // Index by revision ID for lookup
                const byId = new Map<string, LegacyAppRevisionData>()
                for (const rev of revisions) {
                    if (rev.id) byId.set(rev.id, rev)
                }

                // Collect unique variant IDs for batch enrichment
                const variantIds = new Set<string>()
                for (const rev of revisions) {
                    const vid = rev.variantId || (rev as Record<string, unknown>).variant_id
                    if (typeof vid === "string" && vid) variantIds.add(vid)
                }

                // Fetch all variant details in parallel (deduplicated by variantDetailBatchFetcher)
                const variantDetails = new Map<string, VariantDetail | null>()
                if (variantIds.size > 0) {
                    const entries = Array.from(variantIds)
                    const details = await Promise.all(
                        entries.map((vid) =>
                            variantDetailBatchFetcher({variantId: vid, projectId}),
                        ),
                    )
                    entries.forEach((vid, i) => variantDetails.set(vid, details[i]))
                }

                // Map results with enrichment
                for (const revisionId of group.revisionIds) {
                    const key = group.keyMap.get(revisionId)!
                    const rev = byId.get(revisionId)
                    if (!rev) {
                        results.set(key, null)
                        continue
                    }

                    const vid = rev.variantId || (rev as Record<string, unknown>).variant_id
                    const variant = typeof vid === "string" ? variantDetails.get(vid) : undefined
                    if (variant) {
                        results.set(key, {
                            ...rev,
                            variantId: vid as string,
                            appId: variant.appId || rev.appId,
                            variantName: variant.name || rev.variantName,
                            appName: variant.appName || rev.appName,
                            uri: variant.uri || rev.uri,
                        })
                    } else {
                        results.set(key, rev)
                    }
                }
            } catch (error) {
                // On batch failure, set null for all revisions in this project
                for (const revisionId of group.revisionIds) {
                    const key = group.keyMap.get(revisionId)!
                    results.set(key, null)
                }
            }
        }

        return results
    },
})

/**
 * In-memory cache for variant details with 5-minute TTL.
 * Prevents re-fetching the same variant across different batch windows
 * (e.g., when fetchRevisionsList, revisionBatchFetcher, and
 * variantDetailCacheAtomFamily all request the same variant at slightly
 * different times).
 */
const variantDetailCache = new Map<string, {data: VariantDetail | null; expiresAt: number}>()
const VARIANT_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Clear the in-memory variant detail cache.
 * Call after mutations that change variant data (name, URI, etc.)
 * so subsequent fetches get fresh data.
 *
 * @param variantId - Clear a specific variant (across all projects), or omit to clear all
 */
export function clearVariantDetailCache(variantId?: string): void {
    if (!variantId) {
        variantDetailCache.clear()
        return
    }
    for (const key of variantDetailCache.keys()) {
        if (key.endsWith(`:${variantId}`)) {
            variantDetailCache.delete(key)
        }
    }
}

/**
 * Batched variant detail fetcher — deduplicates individual variant detail
 * requests. Since there is no bulk variant endpoint, this executes individual
 * fetches in parallel but prevents the same variantId from being fetched
 * multiple times within the same window. Results are cached in memory for
 * 5 minutes to avoid re-fetches across different batch windows.
 */
export const variantDetailBatchFetcher = createBatchFetcher<
    {variantId: string; projectId: string},
    VariantDetail | null
>({
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.variantId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, VariantDetail | null>()
        const now = Date.now()

        // Resolve from cache first, collect uncached requests
        const uncached = new Map<string, {variantId: string; projectId: string}>()
        requests.forEach((req, index) => {
            const key = serializedKeys[index]
            if (!req.variantId || !req.projectId) {
                results.set(key, null)
                return
            }

            const cached = variantDetailCache.get(key)
            if (cached && cached.expiresAt > now) {
                results.set(key, cached.data)
                return
            }
            uncached.set(key, req)
        })

        // Fetch all uncached variants in parallel
        if (uncached.size > 0) {
            await Promise.all(
                Array.from(uncached.entries()).map(async ([key, req]) => {
                    try {
                        const detail = await fetchVariantDetail(req.variantId, req.projectId)
                        variantDetailCache.set(key, {
                            data: detail,
                            expiresAt: now + VARIANT_CACHE_TTL,
                        })
                        results.set(key, detail)
                    } catch {
                        results.set(key, null)
                    }
                }),
            )
        }

        return results
    },
})

/**
 * Batched revisions list fetcher — collects individual per-variant
 * revisions list requests within a short window and executes them in
 * parallel. Each request fetches `GET /variants/{variantId}/revisions`.
 * The variant detail needed for enrichment is resolved via
 * variantDetailBatchFetcher, which deduplicates across all callers.
 */
export const revisionsListBatchFetcher = createBatchFetcher<
    {variantId: string; projectId: string},
    RevisionListItem[]
>({
    flushDelay: 10,
    serializeKey: (req) => `${req.projectId}:${req.variantId}`,
    batchFn: async (requests, serializedKeys) => {
        const results = new Map<string, RevisionListItem[]>()

        await Promise.all(
            requests.map(async (req, index) => {
                const key = serializedKeys[index]
                if (!req.variantId || !req.projectId) {
                    results.set(key, [])
                    return
                }

                try {
                    const [response, variantDetail] = await Promise.all([
                        axios.get(`${getAgentaApiUrl()}/variants/${req.variantId}/revisions`, {
                            params: {project_id: req.projectId},
                        }),
                        variantDetailBatchFetcher({
                            variantId: req.variantId,
                            projectId: req.projectId,
                        }),
                    ])

                    const data = response.data as ApiRevisionListItem[] | undefined
                    if (!data || !Array.isArray(data)) {
                        results.set(key, [])
                        return
                    }

                    const context = variantDetail
                        ? {appId: variantDetail.appId, uri: variantDetail.uri}
                        : undefined
                    results.set(
                        key,
                        data.map((rev) => transformRevisionToListItem(rev, req.variantId, context)),
                    )
                } catch {
                    results.set(key, [])
                }
            }),
        )

        return results
    },
})

// ============================================================================
// URI UTILITIES
// ============================================================================

/**
 * Normalize a URI by ensuring it has a protocol and removing trailing slashes
 *
 * Handles:
 * - Adding https:// if no protocol present
 * - Fixing /chat and /completion paths to /services/chat and /services/completion
 * - Removing trailing slashes
 */
export function normalizeUri(uri: string | undefined | null): string | undefined {
    if (!uri) return undefined

    let normalized = uri

    // Add protocol if missing
    if (!normalized.includes("http://") && !normalized.includes("https://")) {
        normalized = `https://${normalized}`
    }

    // Fix service paths
    if (!normalized.includes("/services/")) {
        normalized = normalized.replace("/chat", "/services/chat")
        normalized = normalized.replace("/completion", "/services/completion")
    }

    // Remove trailing slash
    if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1)
    }

    return normalized
}

// ============================================================================
// VARIANT DETAIL API (for getting URI)
// ============================================================================

/**
 * Raw variant detail response from API (snake_case)
 * Contains URI which is needed for schema fetching
 */
export interface ApiVariantDetail {
    variant_id: string
    variant_name: string
    app_id: string
    app_name?: string
    base_id?: string
    base_name?: string
    config_name?: string
    uri?: string
    revision?: number
    created_at?: string
    updated_at?: string
}

/**
 * Variant detail with URI (camelCase)
 */
export interface VariantDetail {
    id: string
    name: string
    appId: string
    appName?: string
    baseId?: string
    baseName?: string
    configName?: string
    uri?: string
    revision?: number
    createdAt?: string
    updatedAt?: string
}

/**
 * Fetch a single variant's details including URI
 *
 * Uses: GET /variants/{variant_id}
 *
 * @param variantId - The variant ID
 * @param projectId - The project ID
 * @returns VariantDetail with URI or null if not found
 */
export async function fetchVariantDetail(
    variantId: string,
    projectId: string,
): Promise<VariantDetail | null> {
    if (!variantId || !projectId) return null

    try {
        const response = await axios.get<ApiVariantDetail>(
            `${getAgentaApiUrl()}/variants/${variantId}`,
            {
                params: {project_id: projectId},
            },
        )

        const data = response.data
        if (!data) return null

        return {
            id: data.variant_id,
            name: data.variant_name,
            appId: data.app_id,
            appName: data.app_name,
            baseId: data.base_id,
            baseName: data.base_name,
            configName: data.config_name,
            uri: normalizeUri(data.uri),
            revision: data.revision,
            createdAt: data.created_at,
            updatedAt: data.updated_at,
        }
    } catch (error) {
        console.error("[fetchVariantDetail] Failed to fetch variant", {variantId, error})
        return null
    }
}

/**
 * Fetch revision with enriched data from parent variant
 *
 * This fetches both the revision and its parent variant to get complete data
 * including URI, appId, variantId, variantName, etc.
 *
 * @param revisionId - The revision ID
 * @param variantId - The parent variant ID
 * @param projectId - The project ID
 * @returns LegacyAppRevisionData with complete enriched data
 */
export async function fetchOssRevisionEnriched(
    revisionId: string,
    variantId: string,
    projectId: string,
): Promise<LegacyAppRevisionData | null> {
    if (!revisionId || !variantId || !projectId) return null

    try {
        // Use batch fetchers for deduplication — the revision batch fetcher
        // already enriches with variant detail internally
        const [revision, variantDetail] = await Promise.all([
            revisionBatchFetcher({revisionId, projectId}),
            variantDetailBatchFetcher({variantId, projectId}),
        ])

        if (!revision) return null

        // Merge variant detail into revision if available
        if (variantDetail) {
            return {
                ...revision,
                variantId,
                appId: variantDetail.appId || revision.appId,
                variantName: variantDetail.name || revision.variantName,
                appName: variantDetail.appName || revision.appName,
                uri: variantDetail.uri || revision.uri,
            }
        }

        return revision
    } catch (error) {
        console.error("[fetchOssRevisionEnriched] Failed to fetch enriched revision", {
            revisionId,
            variantId,
            error,
        })
        return null
    }
}

// ============================================================================
// LIST API FUNCTIONS
// ============================================================================

/**
 * Fetch apps list for a project
 *
 * @param projectId - The project ID
 * @returns List of apps transformed to AppListItem format
 */
export async function fetchAppsList(projectId: string): Promise<AppListItem[]> {
    if (!projectId) return []

    try {
        const response = await axios.get(`${getAgentaApiUrl()}/apps`, {
            params: {project_id: projectId},
        })

        const data = response.data as ApiApp[] | undefined
        if (!data || !Array.isArray(data)) return []

        // Filter out legacy custom SDK apps and transform using shared utility
        return data
            .filter((app) => app.app_type !== "custom (sdk)")
            .map((app) => transformAppToListItem(app))
    } catch (error) {
        console.error("[fetchAppsList] Failed to fetch apps:", error)
        return []
    }
}

/**
 * Fetch variants for an app
 *
 * @param appId - The app ID
 * @param projectId - The project ID
 * @returns List of variants transformed to VariantListItem format
 */
export async function fetchVariantsList(
    appId: string,
    projectId: string,
): Promise<VariantListItem[]> {
    if (!projectId || !appId) return []

    try {
        const response = await axios.get(`${getAgentaApiUrl()}/apps/${appId}/variants`, {
            params: {project_id: projectId},
        })

        const data = response.data as ApiVariant[] | undefined
        if (!data || !Array.isArray(data)) return []

        // Transform using shared utility
        return data.map((variant) => transformVariantToListItem(variant, appId))
    } catch (error) {
        console.error("[fetchVariantsList] Failed to fetch variants:", error)
        return []
    }
}

/**
 * Fetch revisions for a variant
 *
 * @param variantId - The variant ID
 * @param projectId - The project ID
 * @returns List of revisions transformed to RevisionListItem format
 */
export async function fetchRevisionsList(
    variantId: string,
    projectId: string,
): Promise<RevisionListItem[]> {
    if (!projectId || !variantId) return []

    try {
        const [response, variantDetail] = await Promise.all([
            axios.get(`${getAgentaApiUrl()}/variants/${variantId}/revisions`, {
                params: {project_id: projectId},
            }),
            variantDetailBatchFetcher({variantId, projectId}),
        ])

        const data = response.data as ApiRevisionListItem[] | undefined
        if (!data || !Array.isArray(data)) return []

        const context = variantDetail
            ? {appId: variantDetail.appId, uri: variantDetail.uri}
            : undefined

        // Transform using shared utility
        return data.map((rev) => transformRevisionToListItem(rev, variantId, context))
    } catch (error) {
        console.error("[fetchRevisionsList] Failed to fetch revisions:", error)
        return []
    }
}

// ============================================================================
// SCHEMA FETCH API
// ============================================================================

/**
 * OpenAPI spec type
 */
export type OpenAPISpec = Record<string, unknown>

/**
 * Fetch OpenAPI schema from a revision's URI
 *
 * Fetches the OpenAPI spec and dereferences all $ref pointers to produce
 * a fully resolved schema.
 *
 * @param uri - The base URI of the revision endpoint
 * @returns The dereferenced OpenAPI spec with runtime info, or null if not found
 */
export async function fetchRevisionSchema(
    uri: string | undefined,
    projectId?: string | null,
): Promise<{
    schema: OpenAPISpec | null
    runtimePrefix: string
    routePath?: string
} | null> {
    if (!uri) return null

    try {
        // Extract runtime prefix and route path from URI using shared utility
        const uriInfo = parseRevisionUri(uri)
        if (!uriInfo) return null

        const {runtimePrefix, routePath} = uriInfo

        // Fetch OpenAPI spec
        const openApiUrl = uri.endsWith("/") ? `${uri}openapi.json` : `${uri}/openapi.json`

        const response = await axios.get<OpenAPISpec>(openApiUrl, {
            params: projectId ? {project_id: projectId} : undefined,
        })
        const rawSchema = response.data

        if (!rawSchema) {
            return {
                schema: null,
                runtimePrefix,
                routePath,
            }
        }

        // Dereference all $ref pointers in the schema
        const {schema: dereferencedSchema, errors} = await dereferenceSchema(rawSchema)

        if (errors && errors.length > 0) {
            console.warn("[fetchRevisionSchema] Schema dereference warnings:", errors)
        }

        return {
            schema: dereferencedSchema,
            runtimePrefix,
            routePath,
        }
    } catch (error) {
        console.error("[fetchRevisionSchema] Failed to fetch schema", {uri, error})
        return null
    }
}

// ============================================================================
// SCHEMA BUILDING
// ============================================================================

// Re-use schema building utilities from appRevision
export {
    buildRevisionSchemaState,
    extractEndpointSchema,
    extractAllEndpointSchemas,
    constructEndpointPath,
} from "../../appRevision/api/schema"

// Validation utilities imported from shared/utils/revisionUtils
