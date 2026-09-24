/**
 * Molecule Utilities
 *
 * Helper functions for cache management, molecule composition, and strict typing.
 */

import {generateId} from "@agenta/shared/utils"
import {getDefaultStore} from "jotai/vanilla"

import type {
    Molecule,
    MoleculeRelation,
    StoreOptions,
} from "../molecule/types"

// ============================================================================
// MOLECULE COMPOSITION
// ============================================================================

/**
 * Get child IDs from parent data using a relation config.
 */
export function getChildIds<TParent, TChild>(
    parent: TParent | null,
    relation: MoleculeRelation<TParent, TChild>,
): string[] {
    if (!parent) return []

    if (typeof relation.childIdsPath === "function") {
        return relation.childIdsPath(parent)
    }

    // Dot-path navigation - traverse unknown object structure
    const path = relation.childIdsPath.split(".")
    let value: unknown = parent
    for (const key of path) {
        if (typeof value !== "object" || value === null) return []
        value = (value as Record<string, unknown>)[key]
        if (value === undefined) return []
    }

    return Array.isArray(value) ? value : []
}

/**
 * Get embedded child data from parent using a relation config.
 */
export function getChildData<TParent, TChild>(
    parent: TParent | null,
    relation: MoleculeRelation<TParent, TChild>,
): TChild[] {
    if (!parent || !relation.childDataPath) return []

    if (typeof relation.childDataPath === "function") {
        return relation.childDataPath(parent) ?? []
    }

    // Dot-path navigation - traverse unknown object structure
    const path = relation.childDataPath.split(".")
    let value: unknown = parent
    for (const key of path) {
        if (typeof value !== "object" || value === null) return []
        value = (value as Record<string, unknown>)[key]
        if (value === undefined) return []
    }

    return Array.isArray(value) ? value : []
}

// ============================================================================
// ID UTILITIES
// ============================================================================

/**
 * Generate a local ID with optional prefix. Crypto-backed: these ids reach surfaces CodeQL
 * treats as security contexts (js/insecure-randomness), and `Math.random` is not fit for that.
 */
export function generateLocalId(prefix = "local"): string {
    return `${prefix}-${Date.now()}-${generateId().replace(/-/g, "").slice(0, 7)}`
}

// ============================================================================
// BATCH UTILITIES
// ============================================================================

/**
 * Batch update multiple entities in a molecule.
 *
 * @example
 * ```typescript
 * batchUpdate(testcaseMolecule, [
 *   { id: 'tc-1', changes: { data: { country: 'USA' } } },
 *   { id: 'tc-2', changes: { data: { country: 'UK' } } },
 * ])
 * ```
 */
export function batchUpdate<T, TDraft>(
    molecule: Molecule<T, TDraft>,
    updates: {id: string; changes: TDraft}[],
    options?: StoreOptions,
): void {
    const store = options?.store ?? getDefaultStore()
    for (const {id, changes} of updates) {
        store.set(molecule.reducers.update, id, changes)
    }
}
