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
    // AgConfig extraction
    extractAgConfigFromEnhanced,
    extractAgConfigFromApi,
    // Validation
    isValidUUID,
    // List API functions
    fetchAppsList,
    fetchVariantsList,
    fetchRevisionsList,
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
    // Types
    type OpenAPISpec,
    type SchemaFetchResult,
} from "./schema"
