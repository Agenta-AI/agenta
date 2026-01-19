/**
 * AppRevision Schema Atoms
 *
 * Entity-scoped schema atoms for OpenAPI schema fetching and selectors.
 * Each revision fetches its own openapi.json based on the revision's URI.
 *
 * NOTE: Schema fetching query is implemented in OSS layer.
 * This module provides the derived selectors that work with the schema data.
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import type {EntitySchema, EntitySchemaProperty} from "../../shared"
import type {RevisionSchemaState} from "../core"

// ============================================================================
// SCHEMA QUERY (ABSTRACT)
// ============================================================================

/**
 * Schema query atom family type - to be set by OSS layer
 */
type SchemaQueryAtomFamilyType = (revisionId: string) => ReturnType<
    typeof atom<{
        data?: RevisionSchemaState
        isPending: boolean
        isError: boolean
        error: Error | null
    }>
>

// Store reference for schema query atom family (set by OSS layer)
let _schemaQueryAtomFamily: SchemaQueryAtomFamilyType | null = null

/**
 * Set the schema query atom family implementation.
 * Called by OSS layer to inject the actual schema query atoms.
 */
export function setSchemaQueryAtomFamily(family: SchemaQueryAtomFamilyType): void {
    console.log("[schemaAtoms] setSchemaQueryAtomFamily called", {
        wasAlreadySet: !!_schemaQueryAtomFamily,
    })
    _schemaQueryAtomFamily = family
}

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
    },
    availableEndpoints: [],
    isChatVariant: false,
}

/**
 * Fallback schema query atom family for when OSS layer hasn't initialized
 */
const fallbackSchemaQueryAtomFamily = atomFamily((_revisionId: string) =>
    atom({
        data: emptySchemaState,
        isPending: false,
        isError: false,
        error: null,
    }),
)

/**
 * Schema query atom family - returns schema state for a revision
 */
export const appRevisionSchemaQueryAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        console.log("[schemaAtoms] appRevisionSchemaQueryAtomFamily called", {
            revisionId,
            hasSchemaQueryFamily: !!_schemaQueryAtomFamily,
        })
        if (_schemaQueryAtomFamily) {
            const result = get(_schemaQueryAtomFamily(revisionId))
            console.log("[schemaAtoms] Got schema from OSS family", {
                revisionId,
                hasData: !!result?.data,
                isPending: result?.isPending,
            })
            return result
        }
        console.log("[schemaAtoms] Using fallback schema family", {revisionId})
        return get(fallbackSchemaQueryAtomFamily(revisionId))
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
