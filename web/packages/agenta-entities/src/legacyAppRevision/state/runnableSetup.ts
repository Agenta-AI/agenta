/**
 * LegacyAppRevision Runnable Extension
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

import {ossAppRevisionSchemaQueryAtomFamily} from "./schemaAtoms"

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
 */
export const invocationUrlAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const schemaQuery = get(ossAppRevisionSchemaQueryAtomFamily(revisionId))
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
        const query = get(ossAppRevisionSchemaQueryAtomFamily(revisionId))
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
        const query = get(ossAppRevisionSchemaQueryAtomFamily(revisionId))
        const endpoints = query.data?.endpoints
        if (!endpoints) return []
        return Object.keys(endpoints)
    }),
)

/**
 * Is chat variant (has messages in schema)
 */
export const isChatVariantAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const query = get(ossAppRevisionSchemaQueryAtomFamily(revisionId))
        const schemaState = query.data
        if (!schemaState?.endpoints) return false

        for (const endpoint of Object.values(schemaState.endpoints)) {
            const ep = endpoint as {messagesSchema?: unknown}
            if (ep?.messagesSchema) return true
        }
        return false
    }),
)

/**
 * Inputs schema for a specific endpoint
 */
export const inputsSchemaAtomFamily = atomFamily(
    (params: {id: string; endpoint?: string}) =>
        atom((get): EntitySchema | null => {
            const query = get(ossAppRevisionSchemaQueryAtomFamily(params.id))
            const schemaState = query.data

            if (!schemaState?.endpoints) return null

            const endpointKey = params.endpoint || "/test"
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
            const query = get(ossAppRevisionSchemaQueryAtomFamily(params.id))
            const schemaState = query.data
            if (!schemaState?.endpoints) return null

            const endpointKey = params.endpoint || "/test"
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
 * Runtime prefix from schema query
 */
export const runtimePrefixAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const schemaQuery = get(ossAppRevisionSchemaQueryAtomFamily(revisionId))
        return schemaQuery.data?.runtimePrefix
    }),
)

/**
 * Route path from schema query
 */
export const routePathAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const schemaQuery = get(ossAppRevisionSchemaQueryAtomFamily(revisionId))
        return schemaQuery.data?.routePath
    }),
)

// ============================================================================
// OUTPUT PORTS
// ============================================================================

/**
 * Output port type for OSS app revisions
 */
export interface OssAppRevisionOutputPort {
    key: string
    name: string
    type: string
    description?: string
}

/**
 * Output ports derived from the revision's OpenAPI schema response.
 */
export const outputPortsAtomFamily = atomFamily((revisionId: string) =>
    atom<OssAppRevisionOutputPort[]>((get) => {
        const schemaQuery = get(ossAppRevisionSchemaQueryAtomFamily(revisionId))

        const outputsSchema = schemaQuery.data?.outputsSchema
        if (!outputsSchema?.properties) {
            // Default output port if no schema defined
            return [
                {
                    key: "output",
                    name: "Output",
                    type: "string",
                },
            ]
        }

        const props = outputsSchema.properties as Record<
            string,
            {type?: string; description?: string}
        >

        return Object.entries(props).map(([key, prop]) => ({
            key,
            name: key,
            type: prop.type || "string",
            description: prop.description,
        }))
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
    outputPorts: outputPortsAtomFamily,
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

/**
 * OSS App Revision runnable extension
 */
export const ossAppRevisionRunnableExtension = {
    atoms: runnableAtoms,
    reducers: runnableReducers,
    get: runnableGet,
    set: runnableSet,
}
