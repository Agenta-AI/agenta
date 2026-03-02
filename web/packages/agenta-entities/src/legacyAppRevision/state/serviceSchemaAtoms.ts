/**
 * LegacyAppRevision Service Schema Prefetch Atoms
 *
 * Provides a two-layer schema resolution strategy (same as appRevision):
 *
 * **Layer 1 — Service schemas (prefetched)**
 * For known service types (completion, chat), the OpenAPI schema is identical
 * across all revisions. These schemas are fetched once at app-selection time
 * and cached, making schema data available immediately when a revision is selected.
 *
 * **Layer 2 — Per-revision schemas (current behavior)**
 * For custom apps, each revision has a unique OpenAPI schema fetched from its URI.
 *
 * @see appRevision/state/serviceSchemaAtoms.ts — Original implementation
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchServiceSchema} from "../../appRevision/api/schema"
import type {RevisionSchemaState} from "../../appRevision/core"
import {APP_SERVICE_TYPES, resolveServiceType, type AppServiceType} from "../../appRevision/core"
import {preheatSchemaMetadata} from "../utils/specDerivation"

import {
    appsListDataAtom,
    appsListAtom,
    appsQueryAtom,
    legacyAppRevisionEntityWithBridgeAtomFamily,
    revisionsQueryAtomFamily,
} from "./store"

// ============================================================================
// LAYER 1: SERVICE SCHEMA PREFETCH
// ============================================================================

/**
 * Prefetch atom for a known service type's OpenAPI schema.
 *
 * Fetches the schema from the deterministic service endpoint
 * (e.g., /services/completion/openapi.json) and caches the result.
 * The schema is structural only — no runtimePrefix or routePath,
 * since those are revision-specific.
 */
const serviceSchemaQueryAtomFamily = atomFamily((serviceType: AppServiceType) =>
    atomWithQuery<RevisionSchemaState | null>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["serviceSchema", serviceType, projectId],
            queryFn: async () => {
                const data = await fetchServiceSchema(serviceType, projectId)
                if (data?.agConfigSchema) {
                    preheatSchemaMetadata(data.agConfigSchema)
                }
                return data
            },
            staleTime: 1000 * 60 * 30, // 30 minutes — service schemas rarely change
            gcTime: 1000 * 60 * 60, // 1 hour garbage collection
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            enabled: !!projectId,
        }
    }),
)

/**
 * Completion service schema — prefetched.
 */
export const completionServiceSchemaAtom = serviceSchemaQueryAtomFamily(
    APP_SERVICE_TYPES.COMPLETION,
)

/**
 * Chat service schema — prefetched.
 */
export const chatServiceSchemaAtom = serviceSchemaQueryAtomFamily(APP_SERVICE_TYPES.CHAT)

// ============================================================================
// METADATA WARMER
// ============================================================================

/**
 * Subscribes to both service schema queries and preheats metadata as soon as
 * schema data is available. This runs independently of any revision — metadata
 * becomes warm at app-selection time, so when a revision is later opened
 * (e.g., variant drawer), UI controls can render correctly on first paint.
 *
 * Subscribe to this atom from AppGlobalWrappers alongside the existing
 * service schema prefetch subscriptions.
 */
export const serviceSchemaMetadataWarmerAtom = atom((get) => {
    let warmed = false

    const completionQuery = get(completionServiceSchemaAtom)
    if (completionQuery.data?.agConfigSchema) {
        preheatSchemaMetadata(completionQuery.data.agConfigSchema)
        warmed = true
    }

    const chatQuery = get(chatServiceSchemaAtom)
    if (chatQuery.data?.agConfigSchema) {
        preheatSchemaMetadata(chatQuery.data.agConfigSchema)
        warmed = true
    }

    return warmed
})

// ============================================================================
// APP TYPE LOOKUP
// ============================================================================

/**
 * Result of looking up a revision's service type.
 */
type ServiceTypeLookup =
    | {status: "resolved"; serviceType: AppServiceType | null}
    | {status: "pending"}

/**
 * Resolve appId for a revision, trying entity data first then the revisions list query.
 *
 * The direct revision query (POST /variants/revisions/query/) often returns data
 * without appId. The entity's non-reactive cache scan may also miss it on first read.
 * When entity has variantId but no appId, we fall back to the reactive
 * revisionsQueryAtomFamily — this query is already fetched by the playground and
 * includes appId on each RevisionListItem (populated from the variant detail
 * that fetchRevisionsList fetches internally). No additional network request.
 */
const resolvedAppIdForRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<{appId: string | undefined; isPending: boolean}>((get) => {
        const entity = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        if (entity?.appId) {
            return {appId: entity.appId, isPending: false}
        }

        // Entity has no appId — try the revisions list query if we have variantId.
        // This query is already running for the playground, so no extra fetch.
        const variantId = entity?.variantId
        if (variantId) {
            const revisionsQuery = get(revisionsQueryAtomFamily(variantId))
            if (revisionsQuery.isPending) {
                return {appId: undefined, isPending: true}
            }
            const revisionsList = (revisionsQuery.data ?? []) as {
                id: string
                appId?: string
            }[]
            const match = revisionsList.find((r) => r.id === revisionId)
            if (match?.appId) {
                return {appId: match.appId, isPending: false}
            }
        }

        // No entity at all — still pending; entity exists but no variantId — unknown
        return {appId: undefined, isPending: !entity}
    }),
)

export const revisionServiceTypeLookupAtomFamily = atomFamily((revisionId: string) =>
    atom<ServiceTypeLookup>((get) => {
        const {appId, isPending: appIdPending} = get(resolvedAppIdForRevisionAtomFamily(revisionId))

        if (!appId) {
            if (appIdPending) {
                return {status: "pending"}
            }
            return {status: "resolved", serviceType: null}
        }

        // Try the overrideable apps list first, then fall back to the direct query
        const apps = get(appsListAtom)
        const app = apps.find((a) => a.id === appId)
        if (!app) {
            const directApps = get(appsListDataAtom)
            const directApp = directApps.find((a) => a.id === appId)
            if (!directApp) {
                const appsQuery = get(appsQueryAtom)
                if (appsQuery.isPending) {
                    return {status: "pending"}
                }
                return {status: "resolved", serviceType: null}
            }
            return {status: "resolved", serviceType: resolveServiceType(directApp.appType)}
        }

        return {status: "resolved", serviceType: resolveServiceType(app.appType)}
    }),
)

// ============================================================================
// SERVICE SCHEMA SELECTOR
// ============================================================================

/**
 * Get the prefetched service schema for a revision, if the app is a known service type.
 *
 * Returns the cached service schema (structural only — no runtimePrefix/routePath)
 * for completion/chat apps, or null for custom apps.
 */
export const serviceSchemaForRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom<{data: RevisionSchemaState | null; isPending: boolean; isAvailable: boolean}>((get) => {
        const lookup = get(revisionServiceTypeLookupAtomFamily(revisionId))

        if (lookup.status === "pending") {
            // Entity or app data not loaded yet — don't fall through to per-revision fetch
            return {data: null, isPending: true, isAvailable: true}
        }

        const serviceType = lookup.serviceType
        if (!serviceType) {
            // Definitively a custom app — no prefetch available
            return {data: null, isPending: false, isAvailable: false}
        }

        const query = get(serviceSchemaQueryAtomFamily(serviceType))

        if (query.isPending) {
            return {data: null, isPending: true, isAvailable: true}
        }

        if (query.isError || !query.data) {
            // Service schema fetch failed — fall back to per-revision fetch
            return {data: null, isPending: false, isAvailable: false}
        }

        return {data: query.data, isPending: false, isAvailable: true}
    }),
)

/**
 * Compose a complete RevisionSchemaState by merging the prefetched service schema
 * with revision-specific runtime context (runtimePrefix, routePath).
 */
export const composedServiceSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<RevisionSchemaState | null>((get) => {
        const serviceResult = get(serviceSchemaForRevisionAtomFamily(revisionId))

        if (!serviceResult.isAvailable || !serviceResult.data) {
            return null
        }

        // Pre-heat metadata from the service schema so downstream derivation
        // (deriveEnhancedPrompts, deriveEnhancedCustomProperties) finds metadata
        // already warm — eliminates microtask timing gap on first read.
        // This is idempotent and follows the same pattern as deriveEnhancedPrompts.
        if (serviceResult.data.agConfigSchema) {
            preheatSchemaMetadata(serviceResult.data.agConfigSchema)
        }

        // Merge with revision-specific runtime context
        const entity = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))

        return {
            ...serviceResult.data,
            runtimePrefix: entity?.runtimePrefix,
            routePath: entity?.routePath,
        }
    }),
)
