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

import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchServiceSchema} from "../../appRevision/api/schema"
import type {RevisionSchemaState} from "../../appRevision/core"
import {APP_SERVICE_TYPES, resolveServiceType, type AppServiceType} from "../../appRevision/core"

import {appsListDataAtom, appsListAtom, legacyAppRevisionEntityWithBridgeAtomFamily} from "./store"

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
    atomWithQuery<RevisionSchemaState | null>(() => ({
        queryKey: ["ossServiceSchema", serviceType],
        queryFn: () => fetchServiceSchema(serviceType),
        staleTime: 1000 * 60 * 30, // 30 minutes — service schemas rarely change
        gcTime: 1000 * 60 * 60, // 1 hour garbage collection
        refetchOnWindowFocus: false,
        refetchOnMount: false,
    })),
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
// APP TYPE LOOKUP
// ============================================================================

/**
 * Result of looking up a revision's service type.
 */
type ServiceTypeLookup =
    | {status: "resolved"; serviceType: AppServiceType | null}
    | {status: "pending"}

/**
 * Look up an app's service type from the apps list using the revision's appId.
 *
 * This atom family resolves: revisionId → appId → app_type → ServiceTypeLookup
 */
export const revisionServiceTypeLookupAtomFamily = atomFamily((revisionId: string) =>
    atom<ServiceTypeLookup>((get) => {
        const entity = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const appId = entity?.appId
        if (!appId) return {status: "pending"}

        // Try the overrideable apps list first, then fall back to the direct query
        const apps = get(appsListAtom)
        const app = apps.find((a) => a.id === appId)
        if (!app) {
            const directApps = get(appsListDataAtom)
            const directApp = directApps.find((a) => a.id === appId)
            if (!directApp) return {status: "pending"}
            return {status: "resolved", serviceType: resolveServiceType(directApp.appType)}
        }

        return {status: "resolved", serviceType: resolveServiceType(app.appType)}
    }),
)

/**
 * @deprecated Use revisionServiceTypeLookupAtomFamily for richer status info
 */
export const revisionServiceTypeAtomFamily = atomFamily((revisionId: string) =>
    atom<AppServiceType | null>((get) => {
        const lookup = get(revisionServiceTypeLookupAtomFamily(revisionId))
        return lookup.status === "resolved" ? lookup.serviceType : null
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

        // Merge with revision-specific runtime context
        const entity = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))

        return {
            ...serviceResult.data,
            runtimePrefix: entity?.runtimePrefix,
            routePath: entity?.routePath,
        }
    }),
)
