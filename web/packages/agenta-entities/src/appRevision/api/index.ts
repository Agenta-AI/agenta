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
    transformEnhancedVariant,
    transformApiRevision,
    transformAppToListItem,
    // Revision parameter extraction
    extractRevisionParametersFromEnhanced,
    extractRevisionParametersFromApiRevision,
    // Deprecated agConfig extraction
    extractAgConfigFromEnhanced,
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
    type EnhancedVariantLike,
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
    // Service schema prefetch
    fetchServiceSchema,
    // Types
    type OpenAPISpec,
    type SchemaFetchResult,
} from "./schema"
