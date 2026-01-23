/**
 * AppRevision Entity Module
 *
 * Complete app revision entity management with:
 * - Zod schemas for validation
 * - Data transformers for API/cache
 * - Jotai state management (molecule pattern)
 * - Schema-aware DrillIn utilities
 *
 * @example
 * ```typescript
 * import {
 *     // Molecule (primary API)
 *     appRevisionMolecule,
 *
 *     // Types
 *     type AppRevisionData,
 *     type ExecutionMode,
 *     type RevisionSchemaState,
 *
 *     // Transformers
 *     transformEnhancedVariant,
 *     transformApiRevision,
 * } from '@agenta/entities/appRevision'
 *
 * // Using the molecule
 * const data = useAtomValue(appRevisionMolecule.atoms.data(revisionId))
 * const schema = useAtomValue(appRevisionMolecule.atoms.agConfigSchema(revisionId))
 *
 * // Imperative API
 * appRevisionMolecule.set.update(revisionId, { agConfig: newConfig })
 * ```
 */

// ============================================================================
// CORE - Schemas and Types
// ============================================================================

export {
    // Zod schemas
    toolCallConfigSchema,
    messageConfigSchema,
    toolConfigSchema,
    responseFormatConfigSchema,
    promptConfigSchema,
    appRevisionDataSchema,
    entitySchemaSchema,
    endpointSchemaSchema,
    revisionSchemaStateSchema,
    executionModeSchema,
    // Parse utilities
    parseAppRevision,
    parsePromptConfig,
    parseMessageConfig,
    createEmptySchemaState,
    createEmptyAppRevision,
    // Parsed type
    type AppRevisionDataParsed,
} from "./core"

export type {
    // Execution mode
    ExecutionMode,
    // Data types
    AppRevisionData,
    PromptConfig,
    MessageConfig,
    ToolConfig,
    ToolCallConfig,
    ResponseFormatConfig,
    // Schema types
    EndpointSchema,
    RevisionSchemaState,
    RawAgConfig,
    SchemaAppRevisionData,
    // Selection types
    AppRevisionSelectionResult,
    // API params
    AppRevisionDetailParams,
    AppRevisionBatchParams,
    AppRevisionListParams,
    // Re-exports
    EntitySchema,
    EntitySchemaProperty,
} from "./core"

// ============================================================================
// API - HTTP Functions and Transformers
// ============================================================================

export {
    // Data transformers
    transformEnhancedVariant,
    transformApiRevision,
    transformAppToListItem,
    extractAgConfigFromEnhanced,
    extractAgConfigFromApi,
    isValidUUID,
    // List API functions
    fetchVariantsList,
    fetchRevisionsList,
    // Schema functions
    constructEndpointPath,
    extractEndpointSchema,
    extractAllEndpointSchemas,
    createEmptyRevisionSchemaState,
    buildRevisionSchemaState,
    getSchemaPropertyAtPath,
    // Types
    type ApiRevision,
    type ApiVariant,
    type ApiRevisionListItem,
    type EnhancedVariantLike,
    type RevisionRequest,
    type VariantListItem,
    type RevisionListItem,
    type AppListItem,
    type OpenAPISpec,
    type SchemaFetchResult,
} from "./api"

// ============================================================================
// STATE - Molecule and Store Atoms
// ============================================================================

export {
    appRevisionMolecule,
    appRevisionSelectionConfig,
    type AppRevisionMolecule,
    type AppRevisionSelectionConfig,
} from "./state"

/**
 * Low-level store atoms for advanced use cases and OSS layer integration.
 *
 * @internal These atoms are implementation details and may change without notice.
 * Prefer using `appRevisionMolecule` API for most use cases.
 *
 * @example
 * ```typescript
 * // Prefer this (stable API):
 * const data = useAtomValue(appRevisionMolecule.atoms.data(id))
 *
 * // Over this (internal, may change):
 * const data = useAtomValue(appRevisionEntityAtomFamily(id))
 * ```
 */
export {
    // List atoms initialization (for OSS layer - apps only required, variants/revisions optional)
    setAppsListAtom,
    setVariantsListAtomFamily,
    setRevisionsListAtomFamily,
    // Query and entity atoms
    appRevisionQueryAtomFamily,
    appRevisionDraftAtomFamily,
    appRevisionEntityAtomFamily,
    appRevisionIsDirtyAtomFamily,
    // List query atoms (self-contained in package)
    appsQueryAtom,
    appsListDataAtom,
    variantsQueryAtomFamily,
    variantsListDataAtomFamily,
    revisionsQueryAtomFamily,
    revisionsListDataAtomFamily,
    // List atoms (all use package queries by default, with optional override)
    appsListAtom,
    variantsListAtomFamily,
    revisionsListAtomFamily,
    // Execution mode atoms
    appRevisionExecutionModeAtomFamily,
    appRevisionEndpointAtomFamily,
    appRevisionInvocationUrlAtomFamily,
    setExecutionModeAtom,
    // Mutations
    updateAppRevisionAtom,
    discardAppRevisionDraftAtom,
    updatePromptAtom,
    updateMessageAtom,
    addMessageAtom,
    deleteMessageAtom,
    reorderMessagesAtom,
    // Schema atoms
    appRevisionSchemaQueryAtomFamily,
    revisionOpenApiSchemaAtomFamily,
    revisionAgConfigSchemaAtomFamily,
    revisionSchemaLoadingAtomFamily,
    revisionPromptSchemaAtomFamily,
    revisionCustomPropertiesSchemaAtomFamily,
    revisionSchemaAtPathAtomFamily,
    revisionEndpointsAtomFamily,
    revisionAvailableEndpointsAtomFamily,
    revisionIsChatVariantAtomFamily,
    revisionInputsSchemaAtomFamily,
    revisionMessagesSchemaAtomFamily,
    revisionRuntimePrefixAtomFamily,
    revisionRoutePathAtomFamily,
} from "./state"

// ============================================================================
// UTILS - Schema Adapter Utilities
// ============================================================================

export {
    // Schema-aware DrillIn
    createSchemaAwareDrillIn,
    // Schema extraction
    extractPromptSchema,
    extractCustomPropertiesSchema,
    getPromptKeys,
    getCustomPropertyKeys,
    // Helpers
    formatKeyAsName,
    unwrapEnhanced,
} from "./utils"
