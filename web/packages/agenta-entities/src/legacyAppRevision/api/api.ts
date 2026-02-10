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
import {dereferenceSchema} from "@agenta/shared/utils"

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
        const variantId = apiRevision.variant_id
        if (variantId) {
            const variantDetail = await fetchVariantDetail(variantId, projectId)
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
        // Fetch both revision and variant in parallel
        const [revisionResponse, variantDetail] = await Promise.all([
            axios.post<RevisionsQueryResponse>(
                `${getAgentaApiUrl()}/variants/revisions/query/`,
                {revision_ids: [revisionId]} as RevisionsQueryRequest,
                {params: {project_id: projectId}},
            ),
            fetchVariantDetail(variantId, projectId),
        ])

        if (!revisionResponse.data?.revisions?.length) return null

        const apiRevision = revisionResponse.data.revisions[0]

        // Transform with enriched context from variant
        return transformApiRevision(apiRevision, {
            variantId,
            appId: variantDetail?.appId,
            variantName: variantDetail?.name,
            appName: variantDetail?.appName,
            uri: variantDetail?.uri,
        })
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
            fetchVariantDetail(variantId, projectId),
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
