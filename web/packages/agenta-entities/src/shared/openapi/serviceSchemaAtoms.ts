/**
 * Shared Service Schema Prefetch Atoms
 *
 * For known service types (completion, chat), the OpenAPI schema is identical
 * across all revisions. These schemas are fetched once at app-selection time
 * and cached, making schema data available immediately when a revision is selected.
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchServiceSchema} from "./schemaFetcher"
import {APP_SERVICE_TYPES, type AppServiceType, type RevisionSchemaState} from "./types"

// ============================================================================
// SERVICE SCHEMA PREFETCH
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
                return fetchServiceSchema(serviceType, projectId)
            },
            staleTime: 1000 * 60 * 30, // 30 minutes — service schemas rarely change
            gcTime: 1000 * 60 * 60, // 1 hour garbage collection
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            enabled: get(sessionAtom) && !!projectId,
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
