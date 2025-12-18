/**
 * Entity Management System
 * Standardized state management for server-sourced entities
 */

// Core
export {createEntityStore} from "./core/createEntityStore"
export type {
    BaseEntity,
    EntityStore,
    EntityStoreConfig,
    EntityMetadata,
    StoredEntity,
    DraftState,
    BatchFetcherConfig,
} from "./core/types"

// Hooks
export {useEntity, useEntityCached, useEntityMetadata, useEntityMutation} from "./hooks/useEntity"
export {useEntityList} from "./hooks/useEntityList"

// History
export {createEntityHistoryManager, UNDO, REDO, RESET} from "./core/history"
export {createUseEntityHistory} from "./core/useEntityHistory"
export type {HistoryLimit, EntityHistoryConfig, EntityHistoryState} from "./core/history"
export type {UseEntityHistoryResult} from "./core/useEntityHistory"

// Testcase entity (example)
export {default as testcaseStore} from "./testcase/store"
export type {Testcase, CreateTestcaseInput, UpdateTestcaseInput} from "./testcase/schema"
export type {FetchTestcasesParams, FetchTestcasesResponse} from "./testcase/store"
