/**
 * AppRevision Schema Atoms
 *
 * Entity-scoped schema atoms for OpenAPI schema fetching and selectors.
 *
 * ## Two-Layer Schema Resolution
 *
 * This module implements a router pattern for schema resolution:
 *
 * 1. **Service schema (fast path)** — For completion/chat apps, the OpenAPI schema
 *    is prefetched at app-selection time from known service endpoints. When a revision
 *    is selected, the schema is already available — no additional fetch needed.
 *
 * 2. **Per-revision schema (fallback)** — For custom apps (or when service schema
 *    is unavailable), the schema is fetched from the revision's URI as before.
 *
 * The router atom `appRevisionSchemaQueryAtomFamily` is the single consumer-facing
 * interface. All downstream atoms read from it transparently.
 *
 * @see serviceSchemaAtoms.ts — Prefetch atoms and composition logic
 */

import {projectIdAtom} from "@agenta/shared/state"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {EntitySchema, EntitySchemaProperty} from "../../shared"
import {fetchRevisionSchema, buildRevisionSchemaState, type OpenAPISpec} from "../api"
import type {RevisionSchemaState} from "../core"

import {
    serviceSchemaForRevisionAtomFamily,
    composedServiceSchemaAtomFamily,
} from "./serviceSchemaAtoms"
import {appRevisionEntityAtomFamily} from "./store"

// ============================================================================
// SCHEMA QUERY (DIRECT)
// ============================================================================

/**
 * Empty schema state for fallback
 */
const emptySchemaState: RevisionSchemaState = {
    openApiSchema: null,
    agConfigSchema: null,
    endpoints: {
        test: null,
        run: null,
        generate: null,
        generateDeployed: null,
        root: null,
    },
    availableEndpoints: [],
    isChatVariant: false,
}

/**
 * Direct schema query that fetches OpenAPI from revision URI.
 *
 * This depends on entity data to get the URI, then fetches and transforms
 * the OpenAPI spec into RevisionSchemaState.
 */
const directSchemaQueryAtomFamily = atomFamily((revisionId: string) =>
    atomWithQuery<RevisionSchemaState>((get) => {
        const projectId = get(projectIdAtom)
        const entityData = get(appRevisionEntityAtomFamily(revisionId))
        const uri = entityData?.uri
        const enabled = !!revisionId && !!uri && !!projectId

        return {
            queryKey: ["appRevisionSchema", revisionId, uri, projectId],
            queryFn: async (): Promise<RevisionSchemaState> => {
                if (!uri) return emptySchemaState

                const result = await fetchRevisionSchema(uri, projectId)
                if (!result || !result.schema) {
                    return {
                        ...emptySchemaState,
                        runtimePrefix: result?.runtimePrefix,
                        routePath: result?.routePath,
                    }
                }

                return buildRevisionSchemaState(
                    result.schema as OpenAPISpec,
                    result.runtimePrefix,
                    result.routePath,
                )
            },
            staleTime: 1000 * 60 * 5, // 5 minutes - schemas change less often
            refetchOnWindowFocus: false,
            enabled,
        }
    }),
)

/**
 * Schema query atom family — **router atom**.
 *
 * This is the single consumer-facing atom for schema data. All downstream atoms
 * (isChatVariant, messagesSchema, agConfigSchema, invocationUrl, etc.) read from
 * this atom. It routes to the appropriate source:
 *
 * 1. **Service schema (fast path):** For completion/chat apps, returns the prefetched
 *    service schema composed with revision-specific runtime context. Available
 *    immediately at revision selection — no per-revision fetch needed.
 *
 * 2. **Per-revision schema (fallback):** For custom apps, or when the service schema
 *    is unavailable, falls back to fetching from the revision's URI (existing behavior).
 *
 * Downstream consumers are unaffected by this routing — they see the same
 * `{ data: RevisionSchemaState, isPending, isError, error }` interface.
 */
export const appRevisionSchemaQueryAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // Layer 1: Try service schema (fast path for completion/chat apps)
        const serviceResult = get(serviceSchemaForRevisionAtomFamily(revisionId))

        if (serviceResult.isAvailable) {
            // Service schema route is active for this revision
            if (serviceResult.isPending) {
                return {
                    data: emptySchemaState,
                    isPending: true,
                    isError: false,
                    error: null,
                }
            }

            // Compose with revision-specific runtime context
            const composed = get(composedServiceSchemaAtomFamily(revisionId))
            if (composed) {
                return {
                    data: composed,
                    isPending: false,
                    isError: false,
                    error: null,
                }
            }

            // Service schema fetch succeeded but composition failed — fall through
        }

        // Layer 2: Per-revision schema (fallback for custom apps or failed service fetch)
        const query = get(directSchemaQueryAtomFamily(revisionId))

        if (query.isPending) {
            return {
                data: emptySchemaState,
                isPending: true,
                isError: false,
                error: null,
            }
        }

        if (query.isError) {
            return {
                data: emptySchemaState,
                isPending: false,
                isError: true,
                error: query.error ?? null,
            }
        }

        return {
            data: query.data ?? emptySchemaState,
            isPending: false,
            isError: false,
            error: null,
        }
    }),
)

// ============================================================================
// SCHEMA SELECTORS
// ============================================================================

/**
 * Get the full openapi schema for a revision
 */
export const revisionOpenApiSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<unknown | null>((get) => {
        const query = get(appRevisionSchemaQueryAtomFamily(revisionId))
        return query.data?.openApiSchema ?? null
    }),
)

/**
 * Get the ag_config schema for a revision
 */
export const revisionAgConfigSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<EntitySchema | null>((get) => {
        const query = get(appRevisionSchemaQueryAtomFamily(revisionId))
        return query.data?.agConfigSchema ?? null
    }),
)

// NOTE: revisionSchemaLoadingAtomFamily is now provided by runnable extension
// See ./runnableSetup.ts - use runnableAtoms.schemaLoading instead

/**
 * Extract prompt schema from ag_config (properties with x-parameters.prompt === true)
 */
export const revisionPromptSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<EntitySchema | null>((get) => {
        const agConfigSchema = get(revisionAgConfigSchemaAtomFamily(revisionId))
        if (!agConfigSchema?.properties) return null

        const promptProperties: Record<string, EntitySchemaProperty> = {}

        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            const xParams = (prop as Record<string, unknown>)?.["x-parameters"] as
                | Record<string, unknown>
                | undefined
            if (xParams?.prompt === true) {
                promptProperties[key] = prop
            }
        })

        if (Object.keys(promptProperties).length === 0) return null

        return {
            type: "object",
            properties: promptProperties,
        }
    }),
)

/**
 * Extract custom properties schema (non-prompt properties)
 */
export const revisionCustomPropertiesSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<EntitySchema | null>((get) => {
        const agConfigSchema = get(revisionAgConfigSchemaAtomFamily(revisionId))
        if (!agConfigSchema?.properties) return null

        const customProperties: Record<string, EntitySchemaProperty> = {}

        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            const xParams = (prop as Record<string, unknown>)?.["x-parameters"] as
                | Record<string, unknown>
                | undefined
            if (xParams?.prompt !== true) {
                customProperties[key] = prop
            }
        })

        if (Object.keys(customProperties).length === 0) return null

        return {
            type: "object",
            properties: customProperties,
        }
    }),
)

/**
 * Get schema property at a specific path within ag_config
 */
export function getSchemaPropertyAtPath(
    schema: EntitySchema | null,
    path: (string | number)[],
): EntitySchemaProperty | null {
    if (!schema || path.length === 0) return schema as EntitySchemaProperty | null

    let current: EntitySchemaProperty | undefined = schema as unknown as EntitySchemaProperty

    for (const segment of path) {
        if (!current) return null

        if (typeof segment === "number") {
            // Array index - use items schema
            if (current.type === "array" && current.items) {
                current = current.items as EntitySchemaProperty
            } else {
                return null
            }
        } else {
            // Object key - use properties
            if (current.type === "object" && current.properties) {
                current = current.properties[segment]
            } else {
                return null
            }
        }
    }

    return current || null
}

/**
 * Create a path-specific schema selector
 */
export const revisionSchemaAtPathAtomFamily = atomFamily(
    ({revisionId, path}: {revisionId: string; path: (string | number)[]}) =>
        atom<EntitySchemaProperty | null>((get) => {
            const agConfigSchema = get(revisionAgConfigSchemaAtomFamily(revisionId))
            return getSchemaPropertyAtPath(agConfigSchema, path)
        }),
    (a, b) => a.revisionId === b.revisionId && JSON.stringify(a.path) === JSON.stringify(b.path),
)

// ============================================================================
// ENDPOINT-SPECIFIC SELECTORS
// ============================================================================

/**
 * Get all endpoint schemas for a revision
 * Note: This is appRevision-specific (includes generate/generateDeployed endpoints)
 */
export const revisionEndpointsAtomFamily = atomFamily((revisionId: string) =>
    atom<RevisionSchemaState["endpoints"]>((get) => {
        const query = get(appRevisionSchemaQueryAtomFamily(revisionId))
        return (
            query.data?.endpoints ?? {
                test: null,
                run: null,
                generate: null,
                generateDeployed: null,
                root: null,
            }
        )
    }),
)

// ============================================================================
// ATOMS NOW PROVIDED BY RUNNABLE EXTENSION
// ============================================================================
// The following atoms are now provided by the runnable extension in ./runnableSetup.ts:
// - revisionAvailableEndpointsAtomFamily → runnableAtoms.availableEndpoints
// - revisionIsChatVariantAtomFamily → runnableAtoms.isChatVariant
// - revisionInputsSchemaAtomFamily → runnableAtoms.inputsSchema
// - revisionMessagesSchemaAtomFamily → runnableAtoms.messagesSchema
// - revisionRuntimePrefixAtomFamily → runnableAtoms.runtimePrefix
// - revisionRoutePathAtomFamily → runnableAtoms.routePath
// - revisionSchemaLoadingAtomFamily → runnableAtoms.schemaLoading
//
// For backward compatibility, these are re-exported in ./index.ts
