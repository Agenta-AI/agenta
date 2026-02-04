/**
 * AppRevision State
 *
 * Jotai atoms and molecule for app revision entity state management.
 */

// ============================================================================
// MOLECULE (Primary API)
// ============================================================================

export {
    appRevisionMolecule,
    appRevisionSelectionConfig,
    type AppRevisionMolecule,
    type AppRevisionSelectionConfig,
} from "./molecule"

// ============================================================================
// STORE ATOMS
// ============================================================================

export {
    // Initialization
    setAppsListAtom,
    setVariantsListAtomFamily,
    setRevisionsListAtomFamily,
    // Query and entity atoms
    appRevisionQueryAtomFamily,
    appRevisionDraftAtomFamily,
    appRevisionEntityAtomFamily,
    appRevisionIsDirtyAtomFamily,
    // Input ports (derived from agConfig)
    appRevisionInputPortsAtomFamily,
    type AppRevisionInputPort,
    // List query atoms (self-contained in package)
    appsQueryAtom,
    appsListDataAtom,
    variantsQueryAtomFamily,
    variantsListDataAtomFamily,
    revisionsQueryAtomFamily,
    revisionsListDataAtomFamily,
    // List atoms (with optional override)
    appsListAtom,
    variantsListAtomFamily,
    revisionsListAtomFamily,
    // Mutations
    updateAppRevisionAtom,
    discardAppRevisionDraftAtom,
    updatePromptAtom,
    updateMessageAtom,
    addMessageAtom,
    deleteMessageAtom,
    reorderMessagesAtom,
} from "./store"

// ============================================================================
// SCHEMA ATOMS
// ============================================================================

export {
    // Schema query (router — auto-resolves service vs per-revision schema)
    appRevisionSchemaQueryAtomFamily,
    // Schema selectors (appRevision-specific)
    revisionOpenApiSchemaAtomFamily,
    revisionAgConfigSchemaAtomFamily,
    revisionPromptSchemaAtomFamily,
    revisionCustomPropertiesSchemaAtomFamily,
    revisionSchemaAtPathAtomFamily,
    getSchemaPropertyAtPath,
    // Endpoint selectors (appRevision-specific)
    revisionEndpointsAtomFamily,
} from "./schemaAtoms"

// ============================================================================
// SERVICE SCHEMA PREFETCH
// ============================================================================

export {
    // Prefetched service schemas
    completionServiceSchemaAtom,
    chatServiceSchemaAtom,
    // Per-revision service type lookup
    revisionServiceTypeAtomFamily,
    // Composed schema (service schema + revision runtime context)
    serviceSchemaForRevisionAtomFamily,
    composedServiceSchemaAtomFamily,
} from "./serviceSchemaAtoms"

// ============================================================================
// RUNNABLE EXTENSION
// ============================================================================

export {
    // Runnable extension
    appRevisionRunnableExtension,
    adaptedSchemaQueryAtomFamily,
    // Direct access to runnable atoms
    runnableAtoms,
    runnableReducers,
    runnableGet,
    runnableSet,
} from "./runnableSetup"

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// ============================================================================
// Re-export runnable atoms with original names for backward compatibility

import {runnableAtoms, runnableReducers} from "./runnableSetup"

/**
 * @deprecated Use appRevisionMolecule.atoms.executionMode instead
 */
export const appRevisionExecutionModeAtomFamily = runnableAtoms.executionMode

/**
 * @deprecated Use appRevisionMolecule.atoms.endpoint instead
 */
export const appRevisionEndpointAtomFamily = runnableAtoms.endpoint

/**
 * @deprecated Use appRevisionMolecule.atoms.invocationUrl instead
 */
export const appRevisionInvocationUrlAtomFamily = runnableAtoms.invocationUrl

/**
 * @deprecated Use appRevisionMolecule.reducers.setExecutionMode instead
 */
export const setExecutionModeAtom = runnableReducers.setExecutionMode

/**
 * @deprecated Use appRevisionMolecule.atoms.schemaLoading instead
 */
export const revisionSchemaLoadingAtomFamily = runnableAtoms.schemaLoading

/**
 * @deprecated Use appRevisionMolecule.atoms.availableEndpoints instead
 */
export const revisionAvailableEndpointsAtomFamily = runnableAtoms.availableEndpoints

/**
 * @deprecated Use appRevisionMolecule.atoms.isChatVariant instead
 */
export const revisionIsChatVariantAtomFamily = runnableAtoms.isChatVariant

/**
 * @deprecated Use appRevisionMolecule.atoms.inputsSchema instead
 */
export const revisionInputsSchemaAtomFamily = runnableAtoms.inputsSchema

/**
 * @deprecated Use appRevisionMolecule.atoms.messagesSchema instead
 */
export const revisionMessagesSchemaAtomFamily = runnableAtoms.messagesSchema

/**
 * @deprecated Use appRevisionMolecule.atoms.runtimePrefix instead
 */
export const revisionRuntimePrefixAtomFamily = runnableAtoms.runtimePrefix

/**
 * @deprecated Use appRevisionMolecule.atoms.routePath instead
 */
export const revisionRoutePathAtomFamily = runnableAtoms.routePath
