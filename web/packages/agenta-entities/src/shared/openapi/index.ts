/**
 * Shared OpenAPI Infrastructure
 *
 * Shared OpenAPI utilities used by workflow and other packages.
 */

// Types and constants
export {
    APP_SERVICE_TYPES,
    SERVICE_ROUTE_PATHS,
    resolveServiceType,
    createEmptySchemaState,
    endpointSchemaSchema,
    revisionSchemaStateSchema,
    type AppServiceType,
    type EndpointSchema,
    type RevisionSchemaState,
    type EntitySchema,
    type EntitySchemaProperty,
} from "./types"

// Pure schema utilities (safe for web workers)
export {
    constructEndpointPath,
    convertOpenApiSchemaToJsonSchema,
    jsonSchemaToEntitySchema,
    extractEndpointSchema,
    extractAllEndpointSchemas,
    createEmptyRevisionSchemaState,
    buildRevisionSchemaState,
    getSchemaPropertyAtPath,
    extractInputKeysFromSchema,
    type OpenAPISpec,
    type SchemaFetchResult,
} from "./schemaUtils"

// Network-dependent schema fetching and URI probing
export {fetchServiceSchema, probeEndpointPath, fetchRevisionSchemaWithProbe} from "./schemaFetcher"

// Service schema prefetch atoms
export {completionServiceSchemaAtom, chatServiceSchemaAtom} from "./serviceSchemaAtoms"
