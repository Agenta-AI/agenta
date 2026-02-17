/**
 * AppRevision API
 *
 * HTTP functions and data transformers for app revision entity.
 */

// ============================================================================
// DATA TRANSFORMATION
// ============================================================================

export {
    // Transform functions
    transformAppToListItem,
    // Revision parameter extraction
    extractRevisionParametersFromApiRevision,
    // Deprecated agConfig extraction
    extractAgConfigFromApi,
    // List API functions
    fetchAppsList,
    fetchVariantsList,
    fetchRevisionsList,
    // Single revision fetch
    fetchRevisionConfig,
    fetchRevisionSchema,
    // Types
    type ApiRevision,
    type ApiVariant,
    type ApiRevisionListItem,
    type ApiApp,
    type RevisionRequest,
    type VariantListItem,
    type RevisionListItem,
    type AppListItem,
} from "./api"

// ============================================================================
// SCHEMA FUNCTIONS
// ============================================================================

export {
    // Path construction
    constructEndpointPath,
    // Schema extraction
    extractEndpointSchema,
    extractAllEndpointSchemas,
    // Schema state builders
    createEmptyRevisionSchemaState,
    buildRevisionSchemaState,
    // Schema path navigation
    getSchemaPropertyAtPath,
    // Schema conversion (openapi-json-schema)
    convertOpenApiSchemaToJsonSchema,
    jsonSchemaToEntitySchema,
    // Service schema prefetch
    fetchServiceSchema,
    // Types
    type OpenAPISpec,
    type SchemaFetchResult,
} from "./schema"
