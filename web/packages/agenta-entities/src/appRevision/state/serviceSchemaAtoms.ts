/**
 * Service Schema Prefetch Atoms
 *
 * Provides a two-layer schema resolution strategy:
 *
 * **Layer 1 — Service schemas (prefetched)**
 * For known service types (completion, chat), the OpenAPI schema is identical
 * across all revisions. These schemas are fetched once at app-selection time
 * and cached, making schema data available immediately when a revision is selected.
 *
 * **Layer 2 — Per-revision schemas (current behavior)**
 * For custom apps, each revision has a unique OpenAPI schema fetched from its URI.
 * This is the existing `directSchemaQueryAtomFamily` behavior.
 *
 * **Router atom**
 * `appRevisionSchemaQueryAtomFamily` (the single consumer-facing atom) routes
 * to the appropriate layer based on the app's service type. Downstream atoms
 * (isChatVariant, messagesSchema, inputPorts, etc.) are unaffected — they
 * continue reading from the same atom with no changes.
 *
 * **Timing gains:**
 * - Completion/chat apps: schema available at app-selection time (before revision load)
 * - Custom apps: unchanged (schema fetched after revision URI is known)
 *
 * @see README.md — "Service Schema Prefetch" section
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchServiceSchema} from "../api"
import type {RevisionSchemaState} from "../core"
import {APP_SERVICE_TYPES, resolveServiceType, type AppServiceType} from "../core"

import {appsListDataAtom, appsListAtom, appRevisionEntityAtomFamily} from "./store"

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
 *
 * Uses a long staleTime because service schemas rarely change within
 * a deployment.
 */
const serviceSchemaQueryAtomFamily = atomFamily((serviceType: AppServiceType) =>
    atomWithQuery<RevisionSchemaState | null>((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["serviceSchema", serviceType, projectId],
            queryFn: () => fetchServiceSchema(serviceType, projectId),
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
 * Becomes available as soon as TanStack Query resolves.
 */
export const completionServiceSchemaAtom = serviceSchemaQueryAtomFamily(
    APP_SERVICE_TYPES.COMPLETION,
)

/**
 * Chat service schema — prefetched.
 * Becomes available as soon as TanStack Query resolves.
 */
export const chatServiceSchemaAtom = serviceSchemaQueryAtomFamily(APP_SERVICE_TYPES.CHAT)

// ============================================================================
// APP TYPE LOOKUP
// ============================================================================

/**
 * Result of looking up a revision's service type.
 *
 * - `resolved`: entity data loaded and app found → serviceType is the result (null = custom)
 * - `pending`: entity data or apps list not yet available → can't determine yet
 */
type ServiceTypeLookup =
    | {status: "resolved"; serviceType: AppServiceType | null}
    | {status: "pending"}

/**
 * Look up an app's service type from the apps list using the revision's appId.
 *
 * This atom family resolves: revisionId → appId → app_type → ServiceTypeLookup
 *
 * Returns `{status: "pending"}` when entity or app data isn't available yet,
 * so the router can distinguish "still loading" from "definitely custom".
 */
export const revisionServiceTypeLookupAtomFamily = atomFamily((revisionId: string) =>
    atom<ServiceTypeLookup>((get) => {
        const entity = get(appRevisionEntityAtomFamily(revisionId))
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

// ============================================================================
// SERVICE SCHEMA SELECTOR
// ============================================================================

/**
 * Get the prefetched service schema for a revision, if the app is a known service type.
 *
 * Returns the cached service schema (structural only — no runtimePrefix/routePath)
 * for completion/chat apps, or null for custom apps.
 *
 * This is the "fast path": when available, consumers get schema data immediately
 * without waiting for a per-revision OpenAPI fetch.
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
 *
 * The service schema provides structural data (endpoints, agConfigSchema, isChatVariant, etc.)
 * while the revision entity data provides the runtime URL components needed for invocation.
 */
export const composedServiceSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<RevisionSchemaState | null>((get) => {
        const serviceResult = get(serviceSchemaForRevisionAtomFamily(revisionId))

        if (!serviceResult.isAvailable || !serviceResult.data) {
            return null
        }

        // Merge with revision-specific runtime context
        const entity = get(appRevisionEntityAtomFamily(revisionId))

        return {
            ...serviceResult.data,
            runtimePrefix: entity?.runtimePrefix,
            routePath: entity?.routePath,
        }
    }),
)
