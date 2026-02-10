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
 * import { appRevisionMolecule, type AppRevisionData } from '@agenta/entities/appRevision'
 *
 * // Reactive atoms (for useAtomValue, atom compositions)
 * const data = useAtomValue(appRevisionMolecule.atoms.data(revisionId))
 * const isDirty = useAtomValue(appRevisionMolecule.atoms.isDirty(revisionId))
 * const schema = useAtomValue(appRevisionMolecule.atoms.agConfigSchema(revisionId))
 *
 * // Runnable capability atoms
 * const inputPorts = useAtomValue(appRevisionMolecule.selectors.inputPorts(revisionId))
 * const outputPorts = useAtomValue(appRevisionMolecule.selectors.outputPorts(revisionId))
 *
 * // Write atoms (for use in other atoms with set())
 * set(appRevisionMolecule.actions.update, revisionId, { agConfig: newConfig })
 * set(appRevisionMolecule.actions.discard, revisionId)
 *
 * // Imperative API (for callbacks outside React/atom context)
 * const data = appRevisionMolecule.get.data(revisionId)
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
    // Service type utilities
    APP_SERVICE_TYPES,
    SERVICE_ROUTE_PATHS,
    resolveServiceType,
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
    // Service types
    AppServiceType,
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
    extractRevisionParametersFromEnhanced,
    extractRevisionParametersFromApiRevision,
    // Deprecated agConfig extraction
    extractAgConfigFromEnhanced,
    extractAgConfigFromApi,
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
    // Service schema prefetch
    fetchServiceSchema,
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
    // Service schema prefetch atoms (mount in app root for eager fetch)
    completionServiceSchemaAtom,
    chatServiceSchemaAtom,
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

// ============================================================================
// SNAPSHOT - Draft Patch Helpers for URL Sharing
// ============================================================================

// Auto-register snapshot adapter when this module is imported
// This ensures the adapter is available in the registry for snapshot operations
import "./snapshotAdapter"
export {
    appRevisionSnapshotAdapter,
    buildAppRevisionDraftPatch,
    applyAppRevisionDraftPatch,
    type AppRevisionDraftPatch,
} from "./snapshotAdapter"

// ============================================================================
// ENTITY RELATIONS
// ============================================================================

/**
 * Entity relations for the app revision hierarchy.
 *
 * - appToVariantRelation: app → variant
 * - variantToRevisionRelation: variant → appRevision
 *
 * Relations are auto-registered when this module is imported.
 * Use the registry to query hierarchies:
 *
 * ```typescript
 * import { entityRelationRegistry } from '@agenta/entities/shared'
 * const path = entityRelationRegistry.getPath("app", "appRevision")
 * // Returns: ["app", "variant", "appRevision"]
 * ```
 */
export {
    appToVariantRelation,
    variantToRevisionRelation,
    registerAppRevisionRelations,
    appsListAtom,
} from "./relations"
