/**
 * Molecule Pattern - Single Entity State Management
 *
 * Core factories and types for creating entity molecules.
 *
 * @example
 * ```typescript
 * import { createMolecule, extendMolecule, type Molecule } from './molecule'
 * ```
 */

// Core factory
export {createMolecule} from "./createMolecule"

// Extension helper
export {extendMolecule, type InferExtendedMolecule} from "./extendMolecule"

// List extension factory
export {
    createListExtension,
    type CreateListExtensionConfig,
    type ListExtension,
    type ListExtensionAtoms,
    type ListExtensionReducers,
    type InferListExtension,
} from "./createListExtension"

// Controller patterns
export {
    createControllerAtomFamily,
    createSelectorsAlias,
    withController,
    type ControllerAtomFamily,
    type ControllerState,
    type ControllerAction,
    type DrillInConfig as ControllerDrillInConfig,
    type CreateControllerConfig,
    type DataPath as ControllerDataPath,
    type MoleculeWithController,
    type WithControllerConfig,
} from "./createControllerAtomFamily"

export {
    createEntityController,
    type DrillInConfig,
    type DrillInValueMode,
    type EntityAction,
    type EntityAPI,
    type EntityActions,
    type EntityControllerAtomFamily,
    type EntityControllerConfig,
    type EntityControllerState,
    type EntityDrillIn,
    type EntitySchemaSelectors,
    type EntitySelectors,
    type PathItem,
    type QueryState,
    type SchemaProperty,
    type UseEntityControllerResult,
} from "./createEntityController"

// Draft state
export {createEntityDraftState, normalizeValueForComparison} from "./createEntityDraftState"

// Local molecule (client-only entities)
export {createLocalMolecule} from "./createLocalMolecule"

// Types
export {
    // Store types
    type Store,
    type StoreOptions,
    // Query state
    type QueryState as MoleculeQueryState,
    // Atom family types
    type AtomFamily,
    type WritableAtomFamily,
    // Core molecule types
    type MoleculeAtoms,
    type MoleculeReducers,
    type Reducer,
    type MoleculeGetters,
    type MoleculeSetters,
    type MoleculeCleanup,
    // Lifecycle types
    type LifecycleCallback,
    type LifecycleUnsubscribe,
    type LifecycleEvent,
    type MoleculeLifecycle,
    type LifecycleConfig,
    // React hook types
    type MoleculeState,
    type MoleculeDispatch,
    type UseControllerResult,
    // Main molecule type
    type Molecule,
    // Config types
    type CreateMoleculeConfig,
    // Extension types
    type ExtendedAtoms,
    type ExtendedReducers,
    type ExtendedGetters,
    type ExtendedSetters,
    type ExtendMoleculeConfig,
    type ExtendedMolecule,
    // Local molecule types
    type LocalMolecule,
    type CreateLocalMoleculeConfig,
    type LocalQueryState,
    // Cache types
    type CacheKeyConfig,
    type CacheRedirectEntry,
    type CacheConfig,
    // Composition types
    type MoleculeRelation,
    type MoleculeWithRelations,
    // Type utilities
    type InferSchemaType,
    type ServerEntity,
    type LocalEntity,
    type AnyEntity,
    // Helper functions
    isLocalEntity,
    isServerEntity,
    getEntityId,
} from "./types"
