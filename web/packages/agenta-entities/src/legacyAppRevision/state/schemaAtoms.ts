/**
 * LegacyAppRevision Schema Atoms
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
 * @see serviceSchemaAtoms.ts — Prefetch atoms and composition logic
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom, type Atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {EntitySchema, EntitySchemaProperty} from "../../shared"
import {isLocalDraftId} from "../../shared"
import {buildRevisionSchemaState, fetchRevisionSchema, type OpenAPISpec} from "../api"
import type {RevisionSchemaState} from "../core"
import {
    deriveEnhancedCustomProperties,
    deriveEnhancedPrompts,
    isPromptProperty,
    type EnhancedCustomProperty,
    type EnhancedPrompt,
} from "../utils/specDerivation"

import {
    composedServiceSchemaAtomFamily,
    serviceSchemaForRevisionAtomFamily,
} from "./serviceSchemaAtoms"
import {
    legacyAppRevisionEntityWithBridgeAtomFamily,
    legacyAppRevisionQueryAtomFamily,
    localDraftSourceRefsByIdAtom,
} from "./store"

// Re-export types and functions from specDerivation for backward compat
export type {EnhancedCustomProperty, EnhancedPrompt}

// ============================================================================
// SCHEMA QUERY
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

function resolveLocalDraftTargetRevisionId(
    get: <Value>(atom: import("jotai").Atom<Value>) => Value,
    localDraftId: string,
): string | null {
    const persistedRefs = get(localDraftSourceRefsByIdAtom)
    let currentId = localDraftId
    let iterations = 0
    const maxIterations = 10

    while (isLocalDraftId(currentId) && iterations < maxIterations) {
        const entity = get(legacyAppRevisionEntityWithBridgeAtomFamily(currentId)) as
            | ({_sourceRevisionId?: string; _baseId?: string; baseId?: string} & Record<
                  string,
                  unknown
              >)
            | null
        const persisted = persistedRefs[currentId]
        const baseId =
            (entity && typeof entity._baseId === "string" ? entity._baseId : null) ??
            (entity && typeof entity.baseId === "string" ? entity.baseId : null) ??
            (typeof persisted?.baseId === "string" ? persisted.baseId : null)
        const sourceId =
            (entity && typeof entity._sourceRevisionId === "string"
                ? entity._sourceRevisionId
                : null) ??
            (typeof persisted?.sourceRevisionId === "string" ? persisted.sourceRevisionId : null)
        const targetId = baseId || sourceId

        if (!targetId || targetId === currentId) {
            return null
        }

        if (!isLocalDraftId(targetId)) {
            return targetId
        }

        currentId = targetId
        iterations += 1
    }

    return null
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
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const uri = entityData?.uri
        const enabled = get(sessionAtom) && !!revisionId && !!uri && !!projectId

        return {
            queryKey: ["legacyAppRevisionSchema", revisionId, uri, projectId],
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

                const schemaState = buildRevisionSchemaState(
                    result.schema as OpenAPISpec,
                    result.runtimePrefix,
                    result.routePath,
                )
                return schemaState
            },
            staleTime: 1000 * 60 * 5, // 5 minutes
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
/** Normalized result shape exposed by the schema query router atom. */
export interface SchemaQueryResult {
    data: RevisionSchemaState
    isPending: boolean
    isError: boolean
    error: Error | null
}

export const legacyAppRevisionSchemaQueryAtomFamily = atomFamily(
    (revisionId: string): Atom<SchemaQueryResult> =>
        atom<SchemaQueryResult>((get) => {
            // Local drafts should inherit schema from their source revision.
            // If source schema is not ready yet, fall back to direct URI schema fetch for the draft.
            if (isLocalDraftId(revisionId)) {
                const localEntity = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
                const localQueryState = get(legacyAppRevisionQueryAtomFamily(revisionId))
                const targetRevisionId = resolveLocalDraftTargetRevisionId(get, revisionId)

                if (targetRevisionId) {
                    const targetQuery = get(
                        legacyAppRevisionSchemaQueryAtomFamily(targetRevisionId),
                    )
                    if (targetQuery.isPending) {
                        return {
                            data: emptySchemaState,
                            isPending: true,
                            isError: false,
                            error: null,
                        }
                    }

                    const targetData = targetQuery.data ?? emptySchemaState
                    return {
                        data: {
                            ...targetData,
                            runtimePrefix: localEntity?.runtimePrefix ?? targetData.runtimePrefix,
                            routePath: localEntity?.routePath ?? targetData.routePath,
                        },
                        isPending: false,
                        isError: targetQuery.isError,
                        error: targetQuery.error ?? null,
                    }
                }

                const hasUri = !!localEntity?.uri
                const isEntityStillLoading = !localEntity && localQueryState.isPending

                if (isEntityStillLoading) {
                    return {
                        data: emptySchemaState,
                        isPending: true,
                        isError: false,
                        error: null,
                    }
                }

                // Local entity data is missing and no query is pending.
                // Treat as resolved-empty to avoid infinite loading for stale local IDs.
                if (!localEntity) {
                    return {
                        data: emptySchemaState,
                        isPending: false,
                        isError: false,
                        error: null,
                    }
                }

                if (!hasUri) {
                    return {
                        data: emptySchemaState,
                        isPending: false,
                        isError: false,
                        error: null,
                    }
                }

                const directQuery = get(directSchemaQueryAtomFamily(revisionId))
                if (directQuery.isPending) {
                    return {
                        data: emptySchemaState,
                        isPending: true,
                        isError: false,
                        error: null,
                    }
                }

                if (directQuery.isError) {
                    return {
                        data: emptySchemaState,
                        isPending: false,
                        isError: true,
                        error: directQuery.error ?? null,
                    }
                }

                return {
                    data: directQuery.data ?? emptySchemaState,
                    isPending: false,
                    isError: false,
                    error: null,
                }
            }

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
            const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
            const entityQueryState = get(legacyAppRevisionQueryAtomFamily(revisionId))
            const hasUri = !!entityData?.uri
            const isEntityStillLoading = !entityData && entityQueryState.isPending

            // Entity still loading — treat as pending (data will arrive)
            if (isEntityStillLoading) {
                return {
                    data: emptySchemaState,
                    isPending: true,
                    isError: false,
                    error: null,
                }
            }

            // Entity query has resolved but no entity exists (missing/stale revision).
            // Return resolved-empty rather than hanging in loading forever.
            if (!entityData) {
                return {
                    data: emptySchemaState,
                    isPending: false,
                    isError: Boolean(entityQueryState.isError),
                    error: entityQueryState.error ?? null,
                }
            }

            // Entity loaded but no URI — schema unavailable (not pending).
            // Return empty schema rather than hanging forever.
            // This check MUST come before reading the direct query, because
            // directSchemaQueryAtomFamily is disabled (enabled=false) when URI
            // is missing, making query.isPending permanently true.
            if (!hasUri) {
                return {
                    data: emptySchemaState,
                    isPending: false,
                    isError: false,
                    error: null,
                }
            }

            const query = get(directSchemaQueryAtomFamily(revisionId))

            // Pending if query is actively fetching
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
        const query = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        return query.data?.openApiSchema ?? null
    }),
)

/**
 * Get the ag_config schema for a revision
 */
export const revisionAgConfigSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<EntitySchema | null>((get) => {
        const query = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        return query.data?.agConfigSchema ?? null
    }),
)

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
 *
 * Identifies prompts by:
 * 1. x-parameters.prompt === true (schema marker)
 * 2. Structure detection (has messages array or llm_config) for custom apps
 */
export const revisionCustomPropertiesSchemaAtomFamily = atomFamily((revisionId: string) =>
    atom<EntitySchema | null>((get) => {
        const agConfigSchema = get(revisionAgConfigSchemaAtomFamily(revisionId))
        const entityData = get(legacyAppRevisionEntityWithBridgeAtomFamily(revisionId))
        const parameters = entityData?.parameters as Record<string, unknown> | undefined

        if (!agConfigSchema?.properties) return null

        const customProperties: Record<string, EntitySchemaProperty> = {}

        Object.entries(agConfigSchema.properties).forEach(([key, prop]) => {
            const propSchema = prop as EntitySchemaProperty
            const savedValue = parameters?.[key]

            // Only include if NOT a prompt
            if (!isPromptProperty(propSchema, savedValue)) {
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
            if (current.type === "array" && current.items) {
                current = current.items as EntitySchemaProperty
            } else {
                return null
            }
        } else {
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
 */
export const revisionEndpointsAtomFamily = atomFamily((revisionId: string) =>
    atom<RevisionSchemaState["endpoints"]>((get) => {
        const query = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
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
