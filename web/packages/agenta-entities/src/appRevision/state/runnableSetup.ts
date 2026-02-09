/**
 * AppRevision Runnable Extension
 *
 * Provides runnable extension atoms for execution mode, schema, and invocation.
 * These atoms extend the base molecule with runnable-specific functionality.
 *
 * @packageDocumentation
 */

import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {StoreOptions, EntitySchema} from "../../shared"
import type {ExecutionMode} from "../core"

import {appRevisionSchemaQueryAtomFamily, revisionAgConfigSchemaAtomFamily} from "./schemaAtoms"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// EXECUTION MODE ATOMS
// ============================================================================

/**
 * Execution mode per revision (direct = /test, deployed = /run)
 */
export const executionModeAtomFamily = atomFamily((revisionId: string) =>
    atom<ExecutionMode>("direct"),
)

/**
 * Endpoint based on execution mode
 */
export const endpointAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const mode = get(executionModeAtomFamily(revisionId))
        return mode === "deployed" ? "/run" : "/test"
    }),
)

/**
 * Full invocation URL based on schema data and execution mode
 *
 * runtimePrefix and routePath come from the OpenAPI schema fetch,
 * not the entity data, since they're extracted from the URI's openapi.json.
 */
export const invocationUrlAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const schemaQuery = get(appRevisionSchemaQueryAtomFamily(revisionId))
        const endpoint = get(endpointAtomFamily(revisionId))

        const runtimePrefix = schemaQuery.data?.runtimePrefix
        if (!runtimePrefix) return null

        const prefix = runtimePrefix.replace(/\/$/, "")
        const routePath = schemaQuery.data?.routePath || ""
        const cleanRoutePath = routePath.replace(/^\//, "").replace(/\/$/, "")
        const cleanEndpoint = endpoint.replace(/^\//, "")

        if (cleanRoutePath) {
            return `${prefix}/${cleanRoutePath}/${cleanEndpoint}`
        }
        return `${prefix}/${cleanEndpoint}`
    }),
)

/**
 * Set execution mode action
 */
export const setExecutionModeAtom = atom(
    null,
    (_get, set, revisionId: string, mode: ExecutionMode) => {
        set(executionModeAtomFamily(revisionId), mode)
    },
)

// ============================================================================
// SCHEMA LOADING STATE
// ============================================================================

/**
 * Schema loading state
 */
export const schemaLoadingAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const query = get(appRevisionSchemaQueryAtomFamily(revisionId))
        return query.isPending
    }),
)

// ============================================================================
// ENDPOINT SELECTORS
// ============================================================================

/**
 * Available endpoints from schema
 */
export const availableEndpointsAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const query = get(appRevisionSchemaQueryAtomFamily(revisionId))
        const endpoints = query.data?.endpoints
        if (!endpoints) return []
        return Object.keys(endpoints)
    }),
)

/**
 * Is chat variant — prefers x-agenta.flags.is_chat from the SDK,
 * falls back to messages schema heuristic (computed in extractAllEndpointSchemas)
 */
export const isChatVariantAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const query = get(appRevisionSchemaQueryAtomFamily(revisionId))
        const schemaState = query.data
        return schemaState?.isChatVariant ?? false
    }),
)

/**
 * Inputs schema for a specific endpoint
 */
export const inputsSchemaAtomFamily = atomFamily(
    (params: {id: string; endpoint?: string}) =>
        atom((get): EntitySchema | null => {
            const query = get(appRevisionSchemaQueryAtomFamily(params.id))
            const schemaState = query.data

            if (!schemaState?.endpoints) return null

            const endpointKey = params.endpoint || "/test"
            // Use Record type to allow dynamic key access
            const endpoints = schemaState.endpoints as Record<
                string,
                {inputsSchema?: EntitySchema} | null | undefined
            >
            const endpoint = endpoints[endpointKey]

            return endpoint?.inputsSchema || null
        }),
    (a, b) => a.id === b.id && a.endpoint === b.endpoint,
)

/**
 * Messages schema for a specific endpoint
 */
export const messagesSchemaAtomFamily = atomFamily(
    (params: {id: string; endpoint?: string}) =>
        atom((get): EntitySchema | null => {
            const query = get(appRevisionSchemaQueryAtomFamily(params.id))
            const schemaState = query.data
            if (!schemaState?.endpoints) return null

            const endpointKey = params.endpoint || "/test"
            // Use Record type to allow dynamic key access
            const endpoints = schemaState.endpoints as Record<
                string,
                {messagesSchema?: EntitySchema} | null | undefined
            >
            const endpoint = endpoints[endpointKey]
            return endpoint?.messagesSchema || null
        }),
    (a, b) => a.id === b.id && a.endpoint === b.endpoint,
)

/**
 * Runtime prefix from schema query (comes from OpenAPI spec fetch)
 */
export const runtimePrefixAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const schemaQuery = get(appRevisionSchemaQueryAtomFamily(revisionId))
        return schemaQuery.data?.runtimePrefix
    }),
)

/**
 * Route path from schema query (comes from OpenAPI spec fetch)
 */
export const routePathAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const schemaQuery = get(appRevisionSchemaQueryAtomFamily(revisionId))
        return schemaQuery.data?.routePath
    }),
)

// ============================================================================
// RUNNABLE EXTENSION EXPORTS
// ============================================================================

/**
 * Runnable atoms collection
 */
export const runnableAtoms = {
    executionMode: executionModeAtomFamily,
    endpoint: endpointAtomFamily,
    invocationUrl: invocationUrlAtomFamily,
    schemaLoading: schemaLoadingAtomFamily,
    availableEndpoints: availableEndpointsAtomFamily,
    isChatVariant: isChatVariantAtomFamily,
    inputsSchema: inputsSchemaAtomFamily,
    messagesSchema: messagesSchemaAtomFamily,
    runtimePrefix: runtimePrefixAtomFamily,
    routePath: routePathAtomFamily,
}

/**
 * Runnable reducers collection
 */
export const runnableReducers = {
    setExecutionMode: setExecutionModeAtom,
}

/**
 * Runnable imperative get API
 */
export const runnableGet = {
    executionMode: (revisionId: string, options?: StoreOptions) =>
        getStore(options).get(executionModeAtomFamily(revisionId)),
    endpoint: (revisionId: string, options?: StoreOptions) =>
        getStore(options).get(endpointAtomFamily(revisionId)),
    invocationUrl: (revisionId: string, options?: StoreOptions) =>
        getStore(options).get(invocationUrlAtomFamily(revisionId)),
}

/**
 * Runnable imperative set API
 */
export const runnableSet = {
    executionMode: (revisionId: string, mode: ExecutionMode, options?: StoreOptions) =>
        getStore(options).set(setExecutionModeAtom, revisionId, mode),
}

// ============================================================================
// RUNNABLE EXTENSION TYPE
// ============================================================================

export const appRevisionRunnableExtension = {
    atoms: runnableAtoms,
    reducers: runnableReducers,
    get: runnableGet,
    set: runnableSet,
}

// ============================================================================
// ADAPTED SCHEMA QUERY
// ============================================================================

/**
 * Schema query adapted for runnable interface
 * Maps the appRevision schema query to a standardized format
 */
export const adaptedSchemaQueryAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const query = get(appRevisionSchemaQueryAtomFamily(revisionId))
        const agConfigSchema = get(revisionAgConfigSchemaAtomFamily(revisionId))

        return {
            data: agConfigSchema,
            isPending: query.isPending,
            isError: query.isError,
            error: query.error,
        }
    }),
)
