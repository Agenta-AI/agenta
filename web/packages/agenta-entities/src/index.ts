/**
 * @agenta/entities - Entity Controller Utilities Package
 *
 * This package provides shared utilities for building entity controllers
 * in the Agenta web application.
 *
 * Architecture:
 * - createEntityController: Factory for creating entity controllers with selectors, actions, and drill-in
 * - createEntityDraftState: Manages draft state for entities with dirty detection
 * - Schema utilities: Helpers for navigating and manipulating entity schemas
 *
 * Entity implementations (appRevision, evaluatorRevision, testcase, etc.) remain in @agenta/oss
 * due to their dependencies on API services and state atoms.
 *
 * @example
 * ```typescript
 * import {
 *   createEntityController,
 *   createEntityDraftState,
 *   getSchemaAtPath,
 * } from '@agenta/entities'
 * ```
 */

// ============================================================================
// SHARED UTILITIES
// ============================================================================

export {
    createEntityDraftState,
    normalizeValueForComparison,
    createEntityController,
    type QueryState,
    type DrillInConfig,
    type DrillInValueMode,
    type EntityAction,
    type EntityAPI,
    type EntityActions,
    type EntityControllerAtomFamily,
    type EntityControllerConfig,
    type EntityControllerState,
    type EntityDrillIn,
    type EntitySelectors,
    type EntitySchemaSelectors,
    type PathItem,
    type SchemaProperty,
    type UseEntityControllerResult,
    // Schema utilities
    type EntitySchema,
    type EntitySchemaProperty,
    type EvaluatorField,
    getSchemaAtPath,
    getSchemaKeys,
    isArrayPath,
    getDefaultValue,
    createDefaultArrayItem,
    evaluatorFieldToSchema,
    evaluatorFieldsToSchema,
    extractPromptSchema,
    extractCustomPropertiesSchema,
    messageSchema,
    messagesSchema,
} from "./shared"

// ============================================================================
// ENTITY MODULES (Import via subpaths)
// ============================================================================
// Entity modules are NOT re-exported here to avoid circular dependency issues
// with atoms that have side effects at load time.
//
// Import entities directly from their subpaths:
//   import { traceSpanMolecule, TraceSpan, ... } from '@agenta/entities/trace'
//   import { evaluatorRevisionMolecule, ... } from '@agenta/entities/evaluatorRevision'
//   import { appRevisionMolecule, ... } from '@agenta/entities/appRevision'
//   import { revisionMolecule, testsetMolecule, ... } from '@agenta/entities/testset'
//   import { testcaseMolecule, ... } from '@agenta/entities/testcase'
//
// For loadable/runnable utilities (playground state):
//   import { useLoadable, loadableController, ... } from '@agenta/entities/loadable'
//   import { useRunnable, executeRunnable, ... } from '@agenta/entities/runnable'

// ============================================================================
// UI UTILITIES
// ============================================================================
// Entity-agnostic UI utilities for building drill-in views and path navigation.
// These work with any molecule and don't depend on specific entity types.
//
// Import from the ui subpath:
//   import { getValueAtPath, type DrillInMoleculeConfig, ... } from '@agenta/entities/ui'
