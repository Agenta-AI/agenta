/**
 * Shared entity utilities and patterns
 *
 * This module provides reusable patterns and utilities for working with entities
 * across different entity types (testsets, testcases, traces, etc.)
 */

// Stateful entity factory - combines entity cache + query in single atom
export {
    createStatefulEntityAtomFamily,
    type QueryResult,
    type StatefulEntityConfig,
    type StatefulEntityResult,
} from "./createStatefulEntityAtomFamily"

// Drill-in state pattern
export {createDrillInState} from "./createDrillInState"

// Entity draft state pattern
export {createEntityDraftState} from "./createEntityDraftState"
